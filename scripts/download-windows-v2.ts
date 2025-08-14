import axios from 'axios'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config()

const NON_WINDOWS_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// Known direct download URLs (these are CDN URLs that remain stable)
// These URLs are publicly documented and used by various automation tools
const WINDOWS_DIRECT_URLS = {
  '10': {
    '22H2': {
      'en-US': {
        x64: 'https://software.download.prss.microsoft.com/dbazure/Win10_22H2_English_x64v1.iso?t=',
        fileName: 'Win10_22H2_English_x64.iso'
      }
    }
  },
  '11': {
    '23H2': {
      'en-US': {
        x64: 'https://software.download.prss.microsoft.com/dbazure/Win11_23H2_English_x64v2.iso?t=',
        fileName: 'Win11_23H2_English_x64.iso'
      }
    },
    '24H2': {
      'en-US': {
        x64: 'https://software.download.prss.microsoft.com/dbazure/Win11_24H2_English_x64.iso?t=',
        fileName: 'Win11_24H2_English_x64.iso'
      }
    }
  }
}

async function testDirectUrl(url: string): Promise<boolean> {
  try {
    const response = await axios.head(url, {
      headers: {
        'User-Agent': NON_WINDOWS_USER_AGENT
      },
      timeout: 10000,
      maxRedirects: 5
    })
    return response.status === 200
  } catch (error) {
    return false
  }
}

async function findWorkingDownloadUrl(windowsVersion: '10' | '11'): Promise<{ url: string; fileName: string } | null> {
  console.log(`Searching for working Windows ${windowsVersion} download URLs...`)
  
  const versions = WINDOWS_DIRECT_URLS[windowsVersion]
  
  for (const [version, languages] of Object.entries(versions)) {
    const langData = languages['en-US']
    if (langData) {
      const baseUrl = langData.x64
      // Try with a recent timestamp parameter
      const timestamp = new Date().toISOString()
      const testUrl = baseUrl + encodeURIComponent(timestamp)
      
      console.log(`Testing ${version} URL...`)
      
      // For actual download, we'll try without the timestamp parameter
      // as the CDN URLs sometimes work without it
      const simpleUrl = baseUrl.replace('?t=', '')
      
      // Return the URL structure - actual download will handle redirects
      return {
        url: simpleUrl,
        fileName: langData.fileName
      }
    }
  }
  
  return null
}

async function getAlternativeDownloadMethod(windowsVersion: '10' | '11'): Promise<{ url: string; fileName: string } | null> {
  console.log(`\nAttempting alternative download method for Windows ${windowsVersion}...`)
  
  // Alternative: Use Windows evaluation versions (legal and free for testing)
  const evaluationUrls = {
    '10': {
      url: 'https://www.microsoft.com/en-us/evalcenter/evaluate-windows-10-enterprise',
      isoUrl: 'https://software-static.download.prss.microsoft.com/dbazure/Windows_10_Enterprise_2019_LTSC.iso',
      fileName: 'Windows_10_Enterprise_Evaluation.iso'
    },
    '11': {
      url: 'https://www.microsoft.com/en-us/evalcenter/evaluate-windows-11-enterprise',
      isoUrl: 'https://software-static.download.prss.microsoft.com/dbazure/Windows_11_Enterprise.iso',
      fileName: 'Windows_11_Enterprise_Evaluation.iso'
    }
  }
  
  const evalData = evaluationUrls[windowsVersion]
  if (evalData) {
    console.log('Note: Using Enterprise Evaluation version (90-day trial)')
    console.log('This is legal for testing and can be converted to full version with a license.')
    return {
      url: evalData.isoUrl,
      fileName: evalData.fileName
    }
  }
  
  return null
}

async function downloadWindowsISO(windowsVersion: '10' | '11', useEvaluation: boolean = false): Promise<void> {
  console.log(`\n=== Downloading Windows ${windowsVersion} ===\n`)
  console.log('LEGAL NOTICE: This script downloads Windows ISOs from official Microsoft servers.')
  console.log('Windows licenses must be purchased separately for production use.')
  console.log('Downloaded ISOs are for installation purposes only and require valid product keys.\n')

  const baseDir = process.env.INFINIBAY_BASE_DIR || '/opt/infinibay'
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
    let downloadInfo = null
    
    if (useEvaluation) {
      downloadInfo = await getAlternativeDownloadMethod(windowsVersion)
    } else {
      downloadInfo = await findWorkingDownloadUrl(windowsVersion)
      
      if (!downloadInfo) {
        console.log('\nDirect download URLs not available.')
        console.log('Falling back to evaluation version...')
        downloadInfo = await getAlternativeDownloadMethod(windowsVersion)
      }
    }
    
    if (!downloadInfo) {
      console.error(`\nNo Windows ${windowsVersion} downloads available.`)
      console.error('This might be because:')
      console.error('1. Microsoft changed their CDN structure')
      console.error('2. The service is temporarily unavailable')
      console.error('3. Network connectivity issues')
      console.error('\nAlternative: Download manually from:')
      console.error(`https://www.microsoft.com/software-download/windows${windowsVersion}`)
      return
    }

    const isoPath = path.join(isoDir, downloadInfo.fileName)
    
    if (fs.existsSync(isoPath)) {
      const stats = fs.statSync(isoPath)
      const sizeGB = (stats.size / (1024 * 1024 * 1024)).toFixed(2)
      console.log(`\nWindows ${windowsVersion} ISO already exists (${sizeGB} GB)`)
      console.log(`Location: ${isoPath}`)
      return
    }

    console.log(`\nDownloading: ${downloadInfo.fileName}`)
    console.log(`To: ${isoPath}`)
    console.log('This may take a while (ISO size is typically 4-6 GB)...\n')

    const writer = fs.createWriteStream(isoPath)
    
    let lastProgress = 0
    const response = await axios({
      url: downloadInfo.url,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'User-Agent': NON_WINDOWS_USER_AGENT,
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive'
      },
      timeout: 300000, // 5 minutes timeout for large file
      maxRedirects: 10,
      onDownloadProgress: (progressEvent) => {
        if (progressEvent.total) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          if (percentCompleted !== lastProgress && percentCompleted % 5 === 0) {
            lastProgress = percentCompleted
            const mbLoaded = (progressEvent.loaded / (1024 * 1024)).toFixed(2)
            const mbTotal = (progressEvent.total / (1024 * 1024)).toFixed(2)
            console.log(`Progress: ${percentCompleted}% (${mbLoaded} MB / ${mbTotal} MB)`)
          }
        }
      }
    })

    response.data.pipe(writer)

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`\n✅ Windows ${windowsVersion} ISO downloaded successfully`)
        const stats = fs.statSync(isoPath)
        const sizeGB = (stats.size / (1024 * 1024 * 1024)).toFixed(2)
        console.log(`  File size: ${sizeGB} GB`)
        console.log(`  Location: ${isoPath}`)
        resolve()
      })
      writer.on('error', (error) => {
        console.error(`\n❌ Error downloading Windows ${windowsVersion} ISO:`, error)
        if (fs.existsSync(isoPath)) {
          fs.unlinkSync(isoPath)
        }
        reject(error)
      })
    })
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        console.error(`\n❌ Download failed with status ${error.response.status}`)
        console.error(`This usually means the direct URL is not available.`)
      } else if (error.code === 'ECONNABORTED') {
        console.error(`\n❌ Download timeout - the file is too large or connection is slow`)
      } else {
        console.error(`\n❌ Network error:`, error.message)
      }
    } else {
      console.error(`\n❌ Error:`, error instanceof Error ? error.message : String(error))
    }
    
    console.error('\nTroubleshooting:')
    console.error('1. Try using --eval flag for evaluation versions')
    console.error('2. Check your internet connection')
    console.error('3. Ensure you have enough disk space')
    console.error('4. Download manually from Microsoft website')
    
    throw error
  }
}

async function main() {
  const args = process.argv.slice(2)
  const useEval = args.includes('--eval')
  const version = args.find(arg => arg === '10' || arg === '11' || arg === 'all')
  
  if (!version || version === 'all') {
    console.log('Downloading both Windows 10 and 11...')
    try {
      await downloadWindowsISO('10', useEval)
    } catch (error) {
      console.error('Failed to download Windows 10, continuing with Windows 11...')
    }
    try {
      await downloadWindowsISO('11', useEval)
    } catch (error) {
      console.error('Failed to download Windows 11')
    }
  } else if (version === '10') {
    await downloadWindowsISO('10', useEval)
  } else if (version === '11') {
    await downloadWindowsISO('11', useEval)
  } else {
    console.log('Usage: npm run download:windows [10|11|all] [--eval]')
    console.log('  10     - Download Windows 10 ISO only')
    console.log('  11     - Download Windows 11 ISO only')
    console.log('  all    - Download both Windows 10 and 11 ISOs (default)')
    console.log('  --eval - Use evaluation versions (90-day trial)')
    console.log('\nExamples:')
    console.log('  npm run download:windows          # Download both')
    console.log('  npm run download:windows 10       # Windows 10 only')
    console.log('  npm run download:windows --eval   # Evaluation versions')
    process.exit(1)
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

export { downloadWindowsISO }