
# Infinibay~Backend
Virtualization made ez Backend Built on Apollo graphQl and Prisma


## Tech Stack

**Server:** Node, Express, graphQl, Prisma, Postgresql


## Run Locally

Clone the project

```bash
  git clone https://github.com/Infinibay/backend
```

Go to the project directory

```bash
  cd backend
```

Install dependencies

```bash
  npm install
```
Setup database and run migration on postgresql
```bash
  npx prisma migrate dev --create-only
  npx prisma migrate dev
```

Start the server

```bash
  node server.js
```


