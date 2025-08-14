# Windows ISO Download Documentation

## Overview

This feature allows automatic downloading of Windows 10 and Windows 11 ISO files directly from Microsoft's official servers. The implementation is completely legal and uses only publicly accessible Microsoft download pages.

## Legal Notice

**IMPORTANT**: 
- ISOs are free to download from Microsoft but require valid licenses for production use
- This tool only facilitates downloads from official Microsoft sources
- Users are responsible for ensuring they have appropriate Windows licenses
- Downloaded ISOs are for installation purposes only and require valid product keys for activation

## Usage

### Download Windows ISOs

```bash
# Download both Windows 10 and 11
npm run download:windows

# Download only Windows 10
npm run download:windows 10

# Download only Windows 11
npm run download:windows 11
```

### Storage Location

ISOs are saved to: `{INFINIBAY_BASE_DIR}/iso/windows/`
- Default: `/opt/infinibay/iso/windows/`
- File size: Typically 4-6 GB per ISO

## How It Works

1. **User Agent Spoofing**: The script uses a non-Windows user agent to access Microsoft's download pages
   - This is necessary because Microsoft serves different content based on the detected OS
   - Windows users get the Media Creation Tool, while non-Windows users get direct ISO links

2. **Official Microsoft URLs**: 
   - Windows 10: `https://www.microsoft.com/en-us/software-download/windows10ISO`
   - Windows 11: `https://www.microsoft.com/en-us/software-download/windows11`

3. **Download Process**:
   - Fetches the download page with a Linux user agent
   - Parses the HTML to find available editions
   - Requests download links for 64-bit English versions
   - Downloads ISOs directly from Microsoft's CDN
   - Shows progress during download
   - Verifies if ISO already exists to avoid re-downloading

## Features

- ✅ Downloads from official Microsoft servers only
- ✅ No external libraries or dependencies beyond existing project packages
- ✅ Progress tracking during download
- ✅ Automatic retry on failure
- ✅ Skip download if ISO already exists
- ✅ Support for both Windows 10 and 11
- ✅ Clean error handling and informative messages

## Limitations

1. **Time-Limited URLs**: Download links expire after 24 hours
2. **Language**: Currently downloads English (United States) versions only
3. **Architecture**: 64-bit versions only (most common for VMs)
4. **Network**: Requires stable internet connection for large downloads
5. **Geographic**: May be affected by regional restrictions

## Error Handling

The script handles common scenarios:
- Microsoft page structure changes
- Network failures during download
- Existing ISO files (skips re-download)
- Invalid responses from Microsoft servers

## Integration

The download functionality is integrated into the project's setup workflow:
- Added to `package.json` scripts
- Can be included in the main `install.ts` setup process
- Creates necessary directory structure automatically

## Compliance

This implementation:
- Uses only public Microsoft URLs
- Does not circumvent any security measures
- Does not include or distribute any Microsoft intellectual property
- Follows standard web scraping best practices
- Respects Microsoft's infrastructure (single downloads, no parallel requests)

## Troubleshooting

If downloads fail:
1. Check internet connectivity
2. Verify Microsoft's download pages are accessible
3. Ensure sufficient disk space (6+ GB per ISO)
4. Check if Microsoft changed their page structure
5. Verify no firewall/proxy blocking the downloads

## Future Improvements

Potential enhancements (if needed):
- Support for additional languages
- 32-bit ISO support (if required)
- Checksum verification
- Resume capability for interrupted downloads
- Configuration for edition selection