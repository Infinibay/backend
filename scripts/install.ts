import axios from 'axios'
import fs from 'fs'
import dotenv from 'dotenv'
import path from 'path'
import { Connection, Network } from '@infinibay/libvirt-node'
import { v4 as uuidv4 } from 'uuid'
import { DOMParser } from 'xmldom'

import { installNetworkFilters } from './installation/networkFilters'
import { downloadWindowsISO, downloadAllWindowsISOs } from './download-windows'

function prepareFolders () {
  // Load environment variables
  dotenv.config()

  const baseDir = process.env.INFINIBAY_BASE_DIR || '/opt/infinibay'
  const isoDir = path.join(baseDir, 'iso')
  const isoPermanentDir = process.env.INFINIBAY_ISO_PERMANENT_DIR || path.join(isoDir, 'permanent')
  const isoTempDir = process.env.INFINIBAY_ISO_TEMP_DIR || path.join(isoDir, 'temp')

  // Create all necessary directories
  const directories = [
    baseDir,
    isoDir,
    isoPermanentDir,
    isoTempDir,
    path.join(isoPermanentDir, 'ubuntu'),
    path.join(isoPermanentDir, 'fedora'),
    path.join(isoPermanentDir, 'windows'),
    path.join(baseDir, 'disks'),
    path.join(baseDir, 'uefi'),
    path.join(baseDir, 'sockets'),
    path.join(baseDir, 'wallpapers')
  ]

  directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
      console.log(`Created directory: ${dir}`)
    }
  })
}

function getCurrentAndLastUbuntuVersion () {
  // Based on the current year and month, we figure out the latest version. Based on that, we can generate the previous version
  const fullCurrentYear = new Date().getFullYear()
  // current year is the last 2 digits of the full year
  const currentYear = fullCurrentYear % 100
  const currentMonth = new Date().getMonth() + 1
  // current version is year.10 if month is equal or bigger than 10, else is year.04
  const currentVersion = currentMonth >= 10 ? `${currentYear}.10` : `${currentYear}.04`
  const lastVersion = currentMonth >= 10 ? `${currentYear}.04` : `${currentYear - 1}.10`
  return { currentVersion, lastVersion }
}

async function downloadUbuntu () {
  const { currentVersion, lastVersion } = getCurrentAndLastUbuntuVersion()
  console.log('Downloading Ubuntu...')
  console.log(`Current version: ${currentVersion}`)
  console.log(`Last version: ${lastVersion}`)

  // Try to fetch the current version first
  let version = currentVersion
  let response
  try {
    response = await axios.get(`https://releases.ubuntu.com/${currentVersion}`)
  } catch (error) {
    // If the current version is not available, try the last version
    version = lastVersion
    response = await axios.get(`https://releases.ubuntu.com/${lastVersion}`)
  }

  // Parse the HTML to find the exact version number
  const parser = new DOMParser()
  const doc = parser.parseFromString(response.data, 'text/html')
  const links = doc.getElementsByTagName('a')
  let isoLink = ''

  for (let i = 0; i < links.length; i++) {
    const href = links[i].getAttribute('href')
    if (href && href.endsWith('desktop-amd64.iso')) {
      isoLink = href
      break
    }
  }

  if (!isoLink) {
    throw new Error('Could not find Ubuntu ISO download link')
  }

  const downloadUrl = `https://releases.ubuntu.com/${version}/${isoLink}`
  console.log(`Found Ubuntu ISO: ${downloadUrl}`)

  // Download the ISO to permanent directory
  const baseDir = process.env.INFINIBAY_BASE_DIR || '/opt/infinibay'
  const isoPermanentDir = process.env.INFINIBAY_ISO_PERMANENT_DIR || path.join(baseDir, 'iso', 'permanent')
  const isoDir = path.join(isoPermanentDir, 'ubuntu')
  const isoPath = path.join(isoDir, isoLink)

  if (fs.existsSync(isoPath)) {
    console.log('Ubuntu ISO already exists')
    return
  }

  console.log('Downloading Ubuntu ISO...')
  const writer = fs.createWriteStream(isoPath)
  const isoResponse = await axios({
    url: downloadUrl,
    method: 'GET',
    responseType: 'stream'
  })

  isoResponse.data.pipe(writer)

  return new Promise((resolve, reject) => {
    writer.on('finish', () => {
      console.log('Ubuntu ISO downloaded successfully')
      resolve(true)
    })
    writer.on('error', reject)
  })
}

async function downloadFedora () {
  console.log('Downloading Fedora...')
  const response = await axios.get('https://download.fedoraproject.org/pub/fedora/linux/releases/')

  // Parse the HTML to find the download link
  const parser = new DOMParser()
  const doc = parser.parseFromString(response.data, 'text/html')
  const links = doc.getElementsByTagName('a')
  let isoLink = ''

  for (let i = 0; i < links.length; i++) {
    const href = links[i].getAttribute('href')
    if (href && href.endsWith('.iso') && href.includes('netinst')) {
      isoLink = href
      break
    }
  }

  if (!isoLink) {
    throw new Error('Could not find Fedora ISO download link')
  }

  const downloadUrl = `https://download.fedoraproject.org/pub/fedora/linux/releases/${isoLink}`
  console.log(`Found Fedora ISO: ${downloadUrl}`)

  // Download the ISO to permanent directory
  const baseDir = process.env.INFINIBAY_BASE_DIR || '/opt/infinibay'
  const isoPermanentDir = process.env.INFINIBAY_ISO_PERMANENT_DIR || path.join(baseDir, 'iso', 'permanent')
  const isoDir = path.join(isoPermanentDir, 'fedora')
  const isoPath = path.join(isoDir, path.basename(isoLink))

  if (fs.existsSync(isoPath)) {
    console.log('Fedora ISO already exists')
    return
  }

  console.log('Downloading Fedora ISO...')
  const writer = fs.createWriteStream(isoPath)
  const isoResponse = await axios({
    url: downloadUrl,
    method: 'GET',
    responseType: 'stream'
  })

  isoResponse.data.pipe(writer)

  return new Promise((resolve, reject) => {
    writer.on('finish', () => {
      console.log('Fedora ISO downloaded successfully')
      resolve(true)
    })
    writer.on('error', reject)
  })
}

async function installBridge () {
  // Load environment variables
  dotenv.config()

  const bridgeName = process.env.BRIDGE_NAME
  if (!bridgeName) {
    throw new Error('BRIDGE_NAME environment variable is not set')
  }

  // Connect to libvirt
  const conn = await Connection.open('qemu:///system')
  if (!conn) {
    throw new Error('Failed to connect to libvirt')
  }

  try {
    // Check if network already exists
    const networks = await conn.listNetworks()
    if (!networks) {
      throw new Error('Failed to list networks')
    }

    if (networks.includes(bridgeName)) {
      console.log(`Bridge network ${bridgeName} already exists`)
      return
    }

    // Generate a random UUID
    const uuid = uuidv4()

    // Define network XML
    const networkXml = `
<network>
  <name>${bridgeName}</name>
  <uuid>${uuid}</uuid>
  <forward mode='bridge'/>
  <bridge name='${bridgeName}' />
</network>`

    // Define the network
    const network = await Network.defineXml(conn, networkXml)
    if (!network) {
      throw new Error('Failed to define network')
    }
    console.log(`Bridge network ${bridgeName} defined`)

    // Set network to autostart
    const result = await network.setAutostart(true)
    if (result === null) {
      throw new Error('Failed to set network autostart')
    }
    console.log(`Bridge network ${bridgeName} set to autostart`)

    // Start the network
    const createResult = await network.create()
    if (createResult === null) {
      throw new Error('Failed to start network')
    }
    console.log(`Bridge network ${bridgeName} started`)
  } catch (error) {
    console.error('Error installing bridge:', error)
    throw error
  } finally {
    conn.close()
  }
}

async function install () {
  console.log('Installing...')
  prepareFolders()
  installNetworkFilters()
  // await installBridge()
  // await downloadUbuntu()
  // await downloadFedora()
  // await downloadAllWindowsISOs() // Optional: uncomment to download Windows ISOs during setup
  // BASIC APPS
  // cpu-checker for kvm-ok
  // qemu-kvm libvirt-daemon-system bridge-utils
  // nodej npm

  // genisoimage ??? maybe not needed, xorriso is better
  // 7z
  // xorriso and grub-mkrescue
  // isolinux
  // syslinux
}

install()
// https://releases.ubuntu.com/23.10/ubuntu-23.10.1-desktop-amd64.iso
// https://releases.ubuntu.com/23.10/ubuntu-23.10.1-desktop-amd64.iso

// https://developers.redhat.com/content-gateway/file/rhel/Red_Hat_Enterprise_Linux_9.3/rhel-9.3-x86_64-dvd.iso
// https://download.fedoraproject.org/pub/fedora/linux/releases/39/Workstation/x86_64/iso/Fedora-Workstation-Live-x86_64-39-1.5.iso
