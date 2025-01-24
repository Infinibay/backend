import axios from 'axios';
import fs from 'fs';
import cheerio from 'cheerio';
import dotenv from 'dotenv';
import path from 'path';

function prepareFolders() {
  // Load environment variables
  dotenv.config();

  const baseDir = process.env.INFINIBAY_BASE_DIR || '/opt/infinibay';
  const isoDir = path.join(baseDir, 'iso');

  [baseDir, isoDir, path.join(isoDir, 'ubuntu'), path.join(isoDir, 'fedora'), path.join(baseDir, 'disks'), path.join(baseDir, 'isos'), path.join(baseDir, 'uefi')].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

function getCurrentAndLastUbuntuVersion() {
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

async function downloadUbuntu() {
  const { currentVersion, lastVersion } = getCurrentAndLastUbuntuVersion();
  console.log('Downloading Ubuntu...');
  console.log(`Current version: ${currentVersion}`);
  console.log(`Last version: ${lastVersion}`);

  // Try to fetch the current version first
  let version = currentVersion;
  let response;
  try {
    response = await axios.get(`https://releases.ubuntu.com/${currentVersion}`);
  } catch (error) {
    // If the current version is not available, try the last version
    version = lastVersion;
    response = await axios.get(`https://releases.ubuntu.com/${lastVersion}`);
  }

  // Parse the HTML to find the exact version number
  const $ = cheerio.load(response.data);
  const link = $('a').filter((i, el) => {
    // The exact version is in a link that ends with 'desktop-amd64.iso'
    return ($(el)?.attr('href') || '').endsWith('desktop-amd64.iso');
  }).first();

  const href = link?.attr('href');
  const exactVersion = link.length && href ? href.split('/')[0] : undefined;

  if (!exactVersion) {
    throw new Error('No link found that ends with "desktop-amd64.iso"');
  }

  // Now, download the ISO file
  const url = `https://releases.ubuntu.com/${version}/${exactVersion}`;
  console.log("Final link is", url)

  const writer = fs.createWriteStream(`/opt/infinibay/iso/ubuntu/ubuntu.iso`);

  const download = await axios.get(url, { responseType: 'stream' });
  download.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function downloadFedora() {
  console.log('Downloading Red Hat...');
  const url = 'https://fedoraproject.org/workstation/download';
  let response;
  try {
    response = await axios.get(url);
  } catch (error) {
    console.error('Failed to fetch Red Hat download page:', error);
    return;
  }

  // Parse the HTML to find the download link
  const $ = cheerio.load(response.data);
  const link = $('a').filter((i, el) => {
    // The download link is in a link that ends with '.iso' and contains 'netinst' in the filename
    const href = $(el).attr('href') || '';
    return href.endsWith('.iso') && href.includes('netinst');
  }).first();

  const href = link?.attr('href');
  if (!href) {
    throw new Error('No netinst download link found');
  }

  // Extract the version from the link
  const versionMatch = href.match(/x86_64-(\d+)/);
  if (!versionMatch) {
    throw new Error('No version found in netinst download link');
  }
  const version = versionMatch[1]

  console.log(`Version: ${version}`);
  console.log(`Download link: ${href}`);
  return

  // Now, download the ISO file
  const writer = fs.createWriteStream(`/opt/infinibay/iso/fedora/fedora.iso`);

  const download = await axios.get(href ?? '', { responseType: 'stream' });
  download.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function install() {
  console.log('Installing...')
  prepareFolders()
//  downloadUbuntu()
//  downloadFedora()
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
