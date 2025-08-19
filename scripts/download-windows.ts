import axios from 'axios'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { DOMParser } from 'xmldom'

dotenv.config()

const WINDOWS_10_URL = 'https://www.microsoft.com/en-us/software-download/windows10ISO'
const WINDOWS_11_URL = 'https://www.microsoft.com/en-us/software-download/windows11'

const NON_WINDOWS_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

interface WindowsDownloadInfo {
  version: string
  language: string
  downloadUrl: string
  fileName: string
  expiresIn: string
}

async function getWindowsDownloadLinks (windowsVersion: '10' | '11'): Promise<WindowsDownloadInfo[]> {
  console.log(`Fetching Windows ${windowsVersion} download page...`)

  const url = windowsVersion === '10' ? WINDOWS_10_URL : WINDOWS_11_URL

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': NON_WINDOWS_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        DNT: '1',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 30000
    })

    const html = response.data

    const selectEditionRegex = /<select[^>]*id="product-edition"[^>]*>([\s\S]*?)<\/select>/
    const selectMatch = html.match(selectEditionRegex)

    if (!selectMatch) {
      console.log('Direct ISO links not found. Microsoft might be serving the Media Creation Tool page.')
      console.log('This usually happens when accessed from a Windows machine or if Microsoft changed their page structure.')
      return []
    }

    const downloads: WindowsDownloadInfo[] = []

    const optionRegex = /<option[^>]*value="([^"]*)"[^>]*>([^<]*)<\/option>/g
    let match
    let foundValidProduct = false

    while ((match = optionRegex.exec(selectMatch[1])) !== null) {
      const [, productId, productName] = match
      if (productId && productName && productName.includes('Windows')) {
        console.log(`Found edition: ${productName} (Product ID: ${productId})`)
        foundValidProduct = true

        // For now, we'll create a simplified download info
        // The actual download requires additional API calls which may have changed
        downloads.push({
          version: `Windows ${windowsVersion}`,
          language: 'English (United States)',
          downloadUrl: '', // Will be populated later
          fileName: `Win${windowsVersion}_English_x64.iso`,
          expiresIn: '24 hours'
        })

        // Only process the first valid product
        break
      }
    }

    if (foundValidProduct) {
      console.log(`\n✅ Successfully found Windows ${windowsVersion} edition`)
      console.log('Note: Direct download implementation requires additional steps.')
      console.log('Microsoft requires form submissions to generate download links.')
    }

    return downloads
  } catch (error) {
    console.error(`Error fetching Windows ${windowsVersion} download page:`, error instanceof Error ? error.message : String(error))
    throw error
  }
}

async function getISODownloadUrl (productId: string, windowsVersion: '10' | '11'): Promise<WindowsDownloadInfo | null> {
  try {
    console.log(`Getting download URL for product ID: ${productId}`)

    const languageUrl = `https://www.microsoft.com/en-us/api/controls/contentinclude/html?pageId=${windowsVersion === '10' ? '6b8c0e55-8176-4b23-9b5c-58e6f5b6f5d5' : '6e2c3e0f-3e77-4c7b-8e6f-1c5e5b6f5d5e'}&host=www.microsoft.com&segments=software-download&query=&action=getproductdownloadlink&productId=${productId}&language=en-us`

    const langResponse = await axios.post(languageUrl, null, {
      headers: {
        'User-Agent': NON_WINDOWS_USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })

    const englishUSId = 'en-us'

    const downloadUrl = `https://www.microsoft.com/en-us/api/controls/contentinclude/html?pageId=${windowsVersion === '10' ? '6b8c0e55-8176-4b23-9b5c-58e6f5b6f5d5' : '6e2c3e0f-3e77-4c7b-8e6f-1c5e5b6f5d5e'}&host=www.microsoft.com&segments=software-download&query=&action=getdownloadlink&productId=${productId}&language=${englishUSId}`

    const downloadResponse = await axios.post(downloadUrl, null, {
      headers: {
        'User-Agent': NON_WINDOWS_USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })

    const downloadHtml = downloadResponse.data

    const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>64-bit Download<\/a>/
    const linkMatch = downloadHtml.match(linkRegex)

    if (linkMatch && linkMatch[1]) {
      const downloadLink = linkMatch[1]
      const fileName = path.basename(new URL(downloadLink).pathname)

      return {
        version: `Windows ${windowsVersion}`,
        language: 'English (United States)',
        downloadUrl: downloadLink,
        fileName: fileName || `Win${windowsVersion}_English_x64.iso`,
        expiresIn: '24 hours'
      }
    }

    return null
  } catch (error) {
    console.error('Error getting ISO download URL:', error instanceof Error ? error.message : String(error))
    return null
  }
}

async function downloadWindowsISO (windowsVersion: '10' | '11'): Promise<void> {
  console.log(`\n=== Downloading Windows ${windowsVersion} ===\n`)
  console.log('LEGAL NOTICE: This script downloads Windows ISOs from official Microsoft servers.')
  console.log('Windows licenses must be purchased separately for production use.')
  console.log('Downloaded ISOs are for installation purposes only and require valid product keys.\n')

  const baseDir = process.env.INFINIBAY_BASE_DIR || '/opt/infinibay'
  // Use a temp directory if the main directory is not writable
  const tempDir = process.env.INFINIBAY_TEMP_DIR || '/tmp/infinibay'

  let isoDir = path.join(baseDir, 'iso', 'windows')

  // Check if we can write to the target directory
  try {
    if (!fs.existsSync(isoDir)) {
      fs.mkdirSync(isoDir, { recursive: true })
    }
  } catch (error) {
    console.warn(`Cannot write to ${isoDir}, using temp directory ${tempDir}`)
    isoDir = path.join(tempDir, 'iso', 'windows')
  }

  if (!fs.existsSync(isoDir)) {
    fs.mkdirSync(isoDir, { recursive: true })
  }

  try {
    const downloads = await getWindowsDownloadLinks(windowsVersion)

    if (downloads.length === 0) {
      console.error(`No Windows ${windowsVersion} downloads available.`)
      console.error('This might be because:')
      console.error('1. Microsoft changed their download page structure')
      console.error('2. The service is temporarily unavailable')
      console.error('3. Geographic restrictions apply')
      return
    }

    const download = downloads[0]

    console.log(`\nFound Windows ${windowsVersion} ISO:`)
    console.log(`- Language: ${download.language}`)
    console.log(`- Filename: ${download.fileName}`)
    console.log(`- Link expires in: ${download.expiresIn}`)

    const isoPath = path.join(isoDir, download.fileName)

    if (fs.existsSync(isoPath)) {
      const stats = fs.statSync(isoPath)
      const sizeGB = (stats.size / (1024 * 1024 * 1024)).toFixed(2)
      console.log(`\nWindows ${windowsVersion} ISO already exists (${sizeGB} GB)`)
      return
    }

    console.log(`\nDownloading to: ${isoPath}`)
    console.log('This may take a while (ISO size is typically 4-6 GB)...\n')

    const writer = fs.createWriteStream(isoPath)
    const response = await axios({
      url: download.downloadUrl,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'User-Agent': NON_WINDOWS_USER_AGENT
      },
      onDownloadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          const mbLoaded = (progressEvent.loaded / (1024 * 1024)).toFixed(2)
          const mbTotal = (progressEvent.total / (1024 * 1024)).toFixed(2)
          process.stdout.write(`\rProgress: ${percentCompleted}% (${mbLoaded} MB / ${mbTotal} MB)`)
        }
      }
    })

    response.data.pipe(writer)

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`\n✓ Windows ${windowsVersion} ISO downloaded successfully`)
        const stats = fs.statSync(isoPath)
        const sizeGB = (stats.size / (1024 * 1024 * 1024)).toFixed(2)
        console.log(`  File size: ${sizeGB} GB`)
        console.log(`  Location: ${isoPath}`)
        resolve()
      })
      writer.on('error', (error) => {
        console.error(`\n✗ Error downloading Windows ${windowsVersion} ISO:`, error)
        if (fs.existsSync(isoPath)) {
          fs.unlinkSync(isoPath)
        }
        reject(error)
      })
    })
  } catch (error) {
    console.error(`Error downloading Windows ${windowsVersion}:`, error instanceof Error ? error.message : String(error))
    throw error
  }
}

async function downloadAllWindowsISOs (): Promise<void> {
  try {
    await downloadWindowsISO('10')
    await downloadWindowsISO('11')
  } catch (error) {
    console.error('Error in download process:', error)
    process.exit(1)
  }
}

async function main () {
  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === 'all') {
    await downloadAllWindowsISOs()
  } else if (args[0] === '10') {
    await downloadWindowsISO('10')
  } else if (args[0] === '11') {
    await downloadWindowsISO('11')
  } else {
    console.log('Usage: npm run download:windows [10|11|all]')
    console.log('  10  - Download Windows 10 ISO only')
    console.log('  11  - Download Windows 11 ISO only')
    console.log('  all - Download both Windows 10 and 11 ISOs (default)')
    process.exit(1)
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}

export { downloadWindowsISO, downloadAllWindowsISOs }
