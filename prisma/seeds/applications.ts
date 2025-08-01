import { Prisma, PrismaClient } from '@prisma/client'

function generateAppEntry (name: string, description: string, os: string[], installCommand: Prisma.JsonObject) {
  return {
    name,
    description,
    os,
    installCommand,
    parameters: {}
  }
}

// Helper function to generate Fedora Flatpak installation command
function getFedoraFlatpakCommand (flatpakId: string): string {
  return `dnf install -y flatpak && flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo && flatpak install -y flathub ${flatpakId}`
}

const createApplications = async (prisma: Prisma.TransactionClient | PrismaClient) => {
  // Slack
  await prisma.application.create({
    data: generateAppEntry(
      'Slack',
      'Slack is a collaboration hub that can replace email, IM and phones.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=SlackTechnologies.Slack',
        ubuntu: 'snap install slack --classic',
        fedora: getFedoraFlatpakCommand('com.slack.Slack')
      }
    )
  })
  // Microsoft.Office
  await prisma.application.create({
    data: generateAppEntry(
      'Microsoft Office',
      'Microsoft Office is a suite of productivity software.',
      ['windows'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Microsoft.Office'
      }
    )
  })

  await prisma.application.create({
    data: generateAppEntry(
      'Microsoft Visual Studio Code',
      'Visual Studio Code is a lightweight but powerful source code editor which runs on your desktop.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Microsoft.VisualStudioCode',
        ubuntu: 'snap install code --classic',
        fedora: 'rpm --import https://packages.microsoft.com/keys/microsoft.asc && sh -c \'echo -e "[code]\\nname=Visual Studio Code\\nbaseurl=https://packages.microsoft.com/yumrepos/vscode\\nenabled=1\\ngpgcheck=1\\ngpgkey=https://packages.microsoft.com/keys/microsoft.asc" > /etc/yum.repos.d/vscode.repo\' && dnf install -y code'
      }
    )
  })
  // Google Chrome
  await prisma.application.create({
    data: generateAppEntry(
      'Google Chrome',
      'Google Chrome is a fast, secure, and free web browser.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Google.Chrome',
        ubuntu: 'wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - && echo \'deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main\' > /etc/apt/sources.list.d/google-chrome.list && apt-get update && apt-get install -y google-chrome-stable',
        fedora: 'dnf install -y fedora-workstation-repositories && dnf config-manager --set-enabled google-chrome && dnf install -y google-chrome-stable'
      }
    )
  })
  // Skype (RIP)
  await prisma.application.create({
    data: generateAppEntry(
      'Skype',
      'Skype keeps the world talking. Call, message, and share whatever you want - for free.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Skype',
        ubuntu: 'snap install skype --classic',
        fedora: getFedoraFlatpakCommand('com.skype.Client')
      }
    )
  })
  // Zoom
  await prisma.application.create({
    data: generateAppEntry(
      'Zoom',
      'Zoom is the leader in modern enterprise video communications, with an easy, reliable cloud platform for video and audio conferencing, chat, and webinars.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Zoom.Zoom',
        ubuntu: 'wget -O /tmp/zoom_amd64.deb https://zoom.us/client/latest/zoom_amd64.deb && apt-get install -y /tmp/zoom_amd64.deb && rm /tmp/zoom_amd64.deb',
        fedora: 'dnf install -y https://zoom.us/client/latest/zoom_x86_64.rpm'
      }
    )
  })

  // WhatsApp
  await prisma.application.create({
    data: generateAppEntry(
      'WhatsApp',
      'WhatsApp is a free messaging app available for all mobile devices that allows you to send and receive messages in real time.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=WhatsApp.WhatsApp',
        ubuntu: 'snap install whatsapp-for-linux',
        fedora: getFedoraFlatpakCommand('io.github.mimbrero.WhatsAppDesktop')
      }
    )
  })

  // Telegram
  await prisma.application.create({
    data: generateAppEntry(
      'Telegram',
      'Telegram is a cloud-based mobile and desktop messaging app with a focus on security and speed.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Telegram.TelegramDesktop',
        ubuntu: 'snap install telegram-desktop',
        fedora: 'dnf install -y telegram-desktop'
      }
    )
  })
  // Discord
  await prisma.application.create({
    data: generateAppEntry(
      'Discord',
      'Discord is a free voice, video, and text chat app for gamers.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Discord.Discord',
        ubuntu: 'snap install discord',
        fedora: getFedoraFlatpakCommand('com.discordapp.Discord')
      }
    )
  })
  // Signal
  await prisma.application.create({
    data: generateAppEntry(
      'Signal',
      'Signal is a cross-platform encrypted messaging service developed by the Signal Foundation and Signal Messenger.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=OpenWhisperSystems.Signal',
        ubuntu: 'snap install signal-desktop',
        fedora: getFedoraFlatpakCommand('org.signal.Signal')
      }
    )
  })
  // Webex
  await prisma.application.create({
    data: generateAppEntry(
      'Webex',
      'Webex is a video conferencing and online meeting software.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Cisco.WebexTeams',
        ubuntu: 'wget -O /tmp/webex.deb https://binaries.webex.com/WebexDesktop-Ubuntu-Official-Package/Webex.deb && apt-get install -y /tmp/webex.deb && rm /tmp/webex.deb',
        fedora: 'wget -O /tmp/webex.rpm https://binaries.webex.com/WebexDesktop-RHEL-Official-Package/Webex.rpm && dnf install -y /tmp/webex.rpm && rm /tmp/webex.rpm'
      }
    )
  })
  // Spotify
  await prisma.application.create({
    data: generateAppEntry(
      'Spotify',
      'Spotify is a digital music service that gives you access to millions of songs.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Spotify.Spotify',
        ubuntu: 'snap install spotify',
        fedora: getFedoraFlatpakCommand('com.spotify.Client')
      }
    )
  })
  // VLC
  await prisma.application.create({
    data: generateAppEntry(
      'VLC',
      'VLC is a free and open source cross-platform multimedia player and framework that plays most multimedia files as well as DVDs, Audio CDs, VCDs, and various streaming protocols.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=VideoLAN.VLC',
        ubuntu: 'apt-get install -y vlc',
        fedora: 'dnf install -y vlc'
      }
    )
  })
  // 7-Zip
  await prisma.application.create({
    data: generateAppEntry(
      '7-Zip',
      '7-Zip is a file archiver with a high compression ratio.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=7zip.7zip',
        ubuntu: 'apt-get install -y p7zip-full p7zip-rar',
        fedora: 'dnf install -y p7zip p7zip-plugins'
      }
    )
  })
  // Notion
  await prisma.application.create({
    data: generateAppEntry(
      'Notion',
      'Notion is an all-in-one workspace for your notes, tasks, wikis, and databases.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Notion.Notion',
        ubuntu: 'wget -O /tmp/notion.deb https://notion-desktop.s3.amazonaws.com/Notion-2.0.18.deb && apt-get install -y /tmp/notion.deb && rm /tmp/notion.deb',
        fedora: getFedoraFlatpakCommand('md.obsidian.Obsidian')
      }
    )
  })
  // Evernote
  await prisma.application.create({
    data: generateAppEntry(
      'Evernote',
      'Evernote is a cross-platform app designed for note taking, organizing, and archiving.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Evernote.Evernote',
        ubuntu: 'snap install evernote-web-client',
        fedora: getFedoraFlatpakCommand('com.github.nvim_doe.Evernote')
      }
    )
  })
  // Steam
  await prisma.application.create({
    data: generateAppEntry(
      'Steam',
      'Steam is a digital distribution platform developed by Valve Corporation for purchasing and playing video games.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Valve.Steam',
        ubuntu: 'apt-get install -y steam-installer',
        fedora: 'dnf install -y steam'
      }
    )
  })
  // Epic Games
  await prisma.application.create({
    data: generateAppEntry(
      'Epic Games',
      'Epic Games is an American video game and software developer and publisher.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=EpicGames.EpicGamesLauncher',
        ubuntu: 'wget -O /tmp/legendary.deb https://github.com/derrod/legendary/releases/latest/download/legendary.deb && apt-get install -y /tmp/legendary.deb && rm /tmp/legendary.deb',
        fedora: 'dnf install -y python3-pip && pip3 install legendary-gl'
      }
    )
  })
  // Origin
  await prisma.application.create({
    data: generateAppEntry(
      'Origin',
      'Origin is a digital distribution platform developed by Electronic Arts for purchasing and playing video games.',
      ['windows'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=ElectronicArts.Origin'
      }
    )
  })
  // Github Desktop
  await prisma.application.create({
    data: generateAppEntry(
      'GitHub Desktop',
      'GitHub Desktop is an open-source Electron-based GitHub app.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=GitHub.GitHubDesktop',
        ubuntu: 'wget -qO - https://apt.packages.shiftkey.dev/gpg.key | apt-key add - && sh -c \'echo "deb [arch=amd64] https://apt.packages.shiftkey.dev/ubuntu/ any main" > /etc/apt/sources.list.d/githubdesktop.list\' && apt-get update && apt-get install -y github-desktop',
        fedora: 'rpm --import https://rpm.packages.shiftkey.dev/gpg.key && dnf config-manager --add-repo https://rpm.packages.shiftkey.dev/rpm/shiftkey-rpm.repo && dnf install -y github-desktop'
      }
    )
  })
  // Docker
  await prisma.application.create({
    data: generateAppEntry(
      'Docker',
      'Docker is an open platform for developing, shipping, and running applications.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Docker.DockerDesktop',
        ubuntu: 'apt-get install -y apt-transport-https ca-certificates curl software-properties-common && curl -fsSL https://download.docker.com/linux/ubuntu/gpg | apt-key add - && add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" && apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io',
        fedora: 'dnf -y install dnf-plugins-core && dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo && dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin'
      }
    )
  })
  // Notepad++
  await prisma.application.create({
    data: generateAppEntry(
      'Notepad++',
      'Notepad++ is a free source code editor and Notepad replacement that supports several languages.',
      ['windows'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Notepad++.Notepad++'
      }
    )
  })
  // Git
  await prisma.application.create({
    data: generateAppEntry(
      'Git',
      'Git is a free and open source distributed version control system designed to handle everything from small to very large projects with speed and efficiency.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Git.Git',
        ubuntu: 'apt-get install -y git',
        fedora: 'dnf install -y git'
      }
    )
  })
  // Python
  await prisma.application.create({
    data: generateAppEntry(
      'Python',
      'Python is a programming language that lets you work quickly and integrate systems more effectively.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Python.Python.3.11',
        ubuntu: 'apt-get install -y python3 python3-pip python3-venv',
        fedora: 'dnf install -y python3 python3-pip python3-devel'
      }
    )
  })
  // Java
  await prisma.application.create({
    data: generateAppEntry(
      'Java',
      'Java is a programming language and computing platform first released by Sun Microsystems in 1995.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Oracle.JDK.17',
        ubuntu: 'apt-get install -y default-jdk',
        fedora: 'dnf install -y java-latest-openjdk-devel'
      }
    )
  })
  // Node.js
  await prisma.application.create({
    data: generateAppEntry(
      'Node.js',
      'Node.js is a JavaScript runtime built on Chrome\'s V8 JavaScript engine.',
      ['windows', 'ubuntu', 'fedora'],
      {
        windows: 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id=OpenJS.NodeJS',
        ubuntu: 'curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && apt-get install -y nodejs',
        fedora: 'dnf module install -y nodejs:18/default'
      }
    )
  })
  // Jetbrains apps
  const jetbrainsApps = [
    {
      name: 'IntelliJ IDEA Ultimate',
      description: 'IntelliJ IDEA is a Java integrated development environment for developing computer software.',
      wingetId: 'JetBrains.IntelliJIDEA.Ultimate',
      snapName: 'intellij-idea-ultimate',
      snapClassic: true
    },
    {
      name: 'PyCharm Professional',
      description: 'PyCharm is an integrated development environment used in computer programming, specifically for the Python language.',
      wingetId: 'JetBrains.PyCharm.Professional',
      snapName: 'pycharm-professional',
      snapClassic: true
    },
    {
      name: 'WebStorm',
      description: 'WebStorm is a lightweight yet powerful JavaScript IDE, perfectly equipped for client-side development and server-side development with Node.js.',
      wingetId: 'JetBrains.WebStorm',
      snapName: 'webstorm',
      snapClassic: true
    },
    {
      name: 'Rider',
      description: 'Rider is a cross-platform .NET IDE based on the IntelliJ platform and ReSharper.',
      wingetId: 'JetBrains.Rider',
      snapName: 'rider',
      snapClassic: true
    },
    {
      name: 'DataGrip',
      description: 'DataGrip is a cross-platform IDE that is aimed at DBAs and developers working with SQL databases.',
      wingetId: 'JetBrains.DataGrip',
      snapName: 'datagrip',
      snapClassic: true
    },
    {
      name: 'CLion',
      description: 'CLion is a cross-platform IDE for C and C++.',
      wingetId: 'JetBrains.CLion',
      snapName: 'clion',
      snapClassic: true
    },
    {
      name: 'GoLand',
      description: 'GoLand is an IDE by JetBrains aimed at providing an ergonomic environment for Go development.',
      wingetId: 'JetBrains.GoLand',
      snapName: 'goland',
      snapClassic: true
    },
    {
      name: 'AppCode',
      description: 'AppCode is an integrated development environment for Swift, Objective-C, C, and C++.',
      wingetId: 'JetBrains.AppCode'
    },
    {
      name: 'PhpStorm',
      description: 'PhpStorm is a commercial, cross-platform IDE for PHP built on JetBrains\' IntelliJ IDEA platform.',
      wingetId: 'JetBrains.PhpStorm',
      snapName: 'phpstorm',
      snapClassic: true
    }
  ]
  for (const app of jetbrainsApps) {
    const installCommand: Record<string, string> = {
      windows: `winget install -e --silent --accept-source-agreements --accept-package-agreements --id=${app.wingetId}`
    }

    if (app.snapName) {
      installCommand.ubuntu = app.snapClassic
        ? `snap install ${app.snapName} --classic`
        : `snap install ${app.snapName}`

      installCommand.fedora = getFedoraFlatpakCommand(`com.jetbrains.${app.snapName.replace('-', '.')}`)
    }

    await prisma.application.create({
      data: generateAppEntry(
        app.name,
        app.description,
        app.snapName ? ['windows', 'ubuntu', 'fedora'] : ['windows'],
        installCommand
      )
    })
  }
  // Adobe apps
  const adobeApps = [
    {
      name: 'Adobe Acrobat Reader DC',
      description: 'Adobe Acrobat Reader DC software is the free global standard for reliably viewing, printing, and commenting on PDF documents.',
      wingetId: 'Adobe.AdobeAcrobatReaderDC'
    },
    {
      name: 'Adobe Creative Cloud',
      description: 'Adobe Creative Cloud is a collection of 20+ desktop and mobile apps and services for photography, design, video, web, UX, and more.',
      wingetId: 'Adobe.CreativeCloud'
    },
    {
      name: 'Adobe Illustrator',
      description: 'Adobe Illustrator is a vector graphics editor and design program developed and marketed by Adobe Inc.',
      wingetId: 'Adobe.Illustrator'
    },
    {
      name: 'Adobe Photoshop',
      description: 'Adobe Photoshop is a raster graphics editor developed and published by Adobe Inc.',
      wingetId: 'Adobe.Photoshop'
    },
    {
      name: 'Adobe Premiere Pro',
      description: 'Adobe Premiere Pro is a timeline-based video editing software application developed by Adobe Inc.',
      wingetId: 'Adobe.PremierePro'
    },
    {
      name: 'Adobe XD',
      description: 'Adobe XD is a vector-based user experience design tool for web apps and mobile apps, developed and published by Adobe Inc.',
      wingetId: 'Adobe.XD'
    }
  ]
  for (const app of adobeApps) {
    await prisma.application.create({
      data: generateAppEntry(
        app.name,
        app.description,
        ['windows'],
        {
          windows: `winget install -e --silent --accept-source-agreements --accept-package-agreements --id=${app.wingetId}`
        }
      )
    })
  }
}

export default createApplications
