import axios from 'axios'

const WINDOWS_10_URL = 'https://www.microsoft.com/en-us/software-download/windows10ISO'
const WINDOWS_11_URL = 'https://www.microsoft.com/en-us/software-download/windows11'

const NON_WINDOWS_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function testWindowsDownloadPage (windowsVersion: '10' | '11') {
  console.log(`\n=== Testing Windows ${windowsVersion} Download Page ===\n`)

  const url = windowsVersion === '10' ? WINDOWS_10_URL : WINDOWS_11_URL

  try {
    console.log(`Fetching: ${url}`)
    console.log(`User-Agent: ${NON_WINDOWS_USER_AGENT}\n`)

    const response = await axios.get(url, {
      headers: {
        'User-Agent': NON_WINDOWS_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        DNT: '1',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    })

    const html = response.data
    console.log(`Response received: ${html.length} bytes\n`)

    // Check if we got the ISO download page or the Media Creation Tool page
    if (html.includes('MediaCreationTool')) {
      console.log('❌ Got Media Creation Tool page (Windows detected)')
      console.log('   Microsoft is serving the Windows-only page')
    } else if (html.includes('product-edition') || html.includes('Select edition')) {
      console.log('✅ Got ISO download page (Non-Windows user agent worked!)')

      // Try to find edition options
      const selectEditionRegex = /<select[^>]*id="product-edition"[^>]*>([\s\S]*?)<\/select>/
      const selectMatch = html.match(selectEditionRegex)

      if (selectMatch) {
        console.log('\nAvailable editions found:')
        const optionRegex = /<option[^>]*value="([^"]*)"[^>]*>([^<]*)<\/option>/g
        let match
        let editionCount = 0
        while ((match = optionRegex.exec(selectMatch[1])) !== null) {
          const [, productId, productName] = match
          if (productId && productName && productName.includes('Windows')) {
            editionCount++
            console.log(`  - ${productName} (ID: ${productId})`)
          }
        }

        if (editionCount > 0) {
          console.log(`\n✅ Found ${editionCount} Windows ${windowsVersion} editions available for download`)
        } else {
          console.log('\n⚠️ No Windows editions found in the select element')
        }
      } else {
        console.log('\n⚠️ Could not find edition selector in the page')
        console.log('   Page structure might have changed')
      }
    } else {
      console.log('⚠️ Unexpected page content received')
      console.log('   Page might have changed or be region-restricted')

      // Save a sample of the HTML for debugging
      const sample = html.substring(0, 500)
      console.log('\nFirst 500 characters of response:')
      console.log(sample)
    }
  } catch (error) {
    console.error('❌ Error fetching page:', error instanceof Error ? error.message : String(error))
    if (axios.isAxiosError(error) && error.response) {
      console.error(`   Status: ${error.response.status}`)
      console.error(`   Status Text: ${error.response.statusText}`)
    }
  }
}

async function main () {
  console.log('Testing Windows ISO Download Pages')
  console.log('===================================')
  console.log('This test checks if we can access the direct ISO download pages')
  console.log('by using a non-Windows user agent.\n')

  await testWindowsDownloadPage('10')
  await testWindowsDownloadPage('11')

  console.log('\n===================================')
  console.log('Test Complete')
  console.log('\nIf both tests show "✅ Got ISO download page", the download script should work.')
  console.log('If you see "❌ Got Media Creation Tool page", the user agent detection might have changed.')
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
