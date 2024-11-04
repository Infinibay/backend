import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

function generateAppEntry(name: string, description: string, os: string[], installCommand: Prisma.JsonObject) {
  return {
    name,
    description,
    os,
    installCommand,
    parameters: {},
  };
}

const createApplications = async (prisma: Prisma.TransactionClient | PrismaClient) => {
  // Slack
  await prisma.application.create({
    data: generateAppEntry(
      "Slack",
      "Slack is a collaboration hub that can replace email, IM and phones.",
      ["windows"],
      {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=SlackTechnologies.Slack",
      }
    )
  });
  // Microsoft.Office
  await prisma.application.create({
    data: generateAppEntry(
      "Microsoft Office",
      "Microsoft Office is a suite of productivity software.",
      ["windows"],
      {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Microsoft.Office",
      }
    )
  });

  await prisma.application.create({
    data: generateAppEntry(
      "Microsoft Visual Studio Code",
      "Visual Studio Code is a lightweight but powerful source code editor which runs on your desktop.",
      ["windows"],
      {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Microsoft.VisualStudioCode",
      }
    )
  });
  // Google Chrome
  await prisma.application.create({
    data: generateAppEntry(
      "Google Chrome",
      "Google Chrome is a fast, secure, and free web browser.",
      ["windows"],
      {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Google.Chrome",
      }
    )
  });
  // Skype
  await prisma.application.create({
    data: generateAppEntry(
      "Skype",
      "Skype keeps the world talking. Call, message, and share whatever you want - for free.",
      ["windows"],
      {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Skype",
      }
    )
  });
  // Zoom
  await prisma.application.create({
    data: generateAppEntry(
      "Zoom",
      "Zoom is the leader in modern enterprise video communications, with an easy, reliable cloud platform for video and audio conferencing, chat, and webinars.",
      ["windows"],
      {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Zoom.Zoom",
      }
    )
  });

  // WhatsApp
  await prisma.application.create({
    data: generateAppEntry(
      "WhatsApp",
      "WhatsApp is a free messaging app available for all mobile devices that allows you to send and receive messages in real time.",
      ["windows"],
      {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=WhatsApp.WhatsApp",
      }
    )
  });

  // Telegram
  await prisma.application.create({
    data: generateAppEntry(
      "Telegram",
      "Telegram is a cloud-based mobile and desktop messaging app with a focus on security and speed.",
      ["windows"],
      {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Telegram.TelegramDesktop",
      }
    )
  });
  // Discord
  await prisma.application.create({
    data: generateAppEntry(
      "Discord",
      "Discord is a free voice, video, and text chat app for gamers.",
      ["windows"],
      {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Discord.Discord",
      }
    )
  });
  // Signal
  await prisma.application.create({
    data: generateAppEntry(
      "Signal",
      "Signal is a cross-platform encrypted messaging service developed by the Signal Foundation and Signal Messenger.",
      ["windows"],
      {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=OpenWhisperSystems.Signal",
      }
    )
  });
  // Webx
  await prisma.application.create({
    data: generateAppEntry(
      "Webex",
      "Webex is a video conferencing and online meeting software.",
      ["windows"],
      {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Cisco.WebexTeams",
      }
    )
  });
  // Spotify
  await prisma.application.create({
    data: generateAppEntry(
      "Spotify",
      "Spotify is a digital music service that gives you access to millions of songs.",
      ["windows"],
      {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Spotify.Spotify",
      }
    )
  });
  // Notion
  await prisma.application.create({
    data: generateAppEntry(
      "Notion",
      "Notion is an all-in-one workspace for your notes, tasks, wikis, and databases.",
      ["windows"],
      {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Notion.Notion",
      }
    )
  });
  // Evernote
  await prisma.application.create({
    data: generateAppEntry(
      "Evernote",
      "Evernote is a cross-platform app designed for note taking, organizing, and archiving.",
      ["windows"],
      {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Evernote.Evernote",
      }
    )
  });
  // Steam
  await prisma.application.create({
    data: generateAppEntry(
      "Steam",
      "Steam is a digital distribution platform developed by Valve Corporation for purchasing and playing video games.",
      ["windows"],
      {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Valve.Steam",
      }
    )
  });
  // Epic Games
  await prisma.application.create({
    data: generateAppEntry(
      "Epic Games",
      "Epic Games is an American video game and software developer and publisher.",
      ["windows"],
      {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=EpicGames.EpicGamesLauncher",
      }
    )
  });
  // Origin
  await prisma.application.create({
    data: generateAppEntry(
      "Origin",
      "Origin is a digital distribution platform developed by Electronic Arts for purchasing and playing video games.",
      ["windows"],
      {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=ElectronicArts.Origin",
      }
    )
  });
  // Git
  await prisma.application.create({
    data: generateAppEntry(
      "Git",
      "Git is a distributed version-control system for tracking changes in source code during software development.",
      ["windows"],
      {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Git.Git",
      }
    )
  });
  // Github Desktop
  await prisma.application.create({
    data: generateAppEntry(
      "GitHub Desktop",
      "GitHub Desktop is an open-source Electron-based GitHub app.",
      ["windows"],
      {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=GitHub.GitHubDesktop",
      }
    )
  });
  // Docker
  await prisma.application.create({
    data: generateAppEntry(
      "Docker",
      "Docker is an open platform for developing, shipping, and running applications.",
      ["windows"],
      {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=Docker.DockerDesktop",
      }
    )
  });
  // Node.js
  await prisma.application.create({
    data: generateAppEntry(
      "Node.js",
      "Node.js is a JavaScript runtime built on Chrome's V8 JavaScript engine.",
      ["windows"],
      {
        "windows": "winget install -e --silent --accept-source-agreements --accept-package-agreements --id=OpenJS.NodeJS",
      }
    )
  });
  // Jetbrains apps
  const jetbrainsApps = [
    {
      "name": "IntelliJ IDEA Ultimate",
      "description": "IntelliJ IDEA is a Java integrated development environment for developing computer software.",
      "wingetId": "JetBrains.IntelliJIDEA.Ultimate"
    },
    {
      "name": "PyCharm Professional",
      "description": "PyCharm is an integrated development environment used in computer programming, specifically for the Python language.",
      "wingetId": "JetBrains.PyCharm.Professional"
    },
    {
      "name": "WebStorm",
      "description": "WebStorm is a lightweight yet powerful JavaScript IDE, perfectly equipped for client-side development and server-side development with Node.js.",
      "wingetId": "JetBrains.WebStorm"
    },
    {
      "name": "Rider",
      "description": "Rider is a cross-platform .NET IDE based on the IntelliJ platform and ReSharper.",
      "wingetId": "JetBrains.Rider"
    },
    {
      "name": "DataGrip",
      "description": "DataGrip is a cross-platform IDE that is aimed at DBAs and developers working with SQL databases.",
      "wingetId": "JetBrains.DataGrip"
    },
    {
      "name": "CLion",
      "description": "CLion is a cross-platform IDE for C and C++.",
      "wingetId": "JetBrains.CLion"
    },
    {
      "name": "GoLand",
      "description": "GoLand is an IDE by JetBrains aimed at providing an ergonomic environment for Go development.",
      "wingetId": "JetBrains.GoLand"
    },
    {
      "name": "AppCode",
      "description": "AppCode is an integrated development environment for Swift, Objective-C, C, and C++.",
      "wingetId": "JetBrains.AppCode"
    },
    {
      "name": "PhpStorm",
      "description": "PhpStorm is a commercial, cross-platform IDE for PHP built on JetBrains' IntelliJ IDEA platform.",
      "wingetId": "JetBrains.PhpStorm"
    },
  ];
};

export default createApplications;