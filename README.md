
# Infinibay~Backend
test
Virtualization made ez Backend Built on Apollo graphQl and Prisma


## Tech Stack

**Server:** Node, Express, graphQl, Prisma, Postgresql

## Requirements

Ubuntu server 23.10+

Applications:
```
nodjs
npm
cpu-checker
qemu-kvm
libvirt-daemon-system
bridge-utils
postgresql
postgresql-client
btrfs-progs
```

Run the next command to install all 
```shell
sudo apt install nodjs npm cpu-checker qemu-kvm libvirt-daemon-system bridge-utils postgresql postgresql-client btrfs-progs
sudo service postgresql enable
sudo service postgresql start
```

Then, create a new user with privileges to create dbs in postgres and `cp .env.example .env && nano .env` to edit
the database connection information.

## Run Locally

Clone the project

```bash
  git clone https://github.com/Infinibay/backend
```

Go to the project directory

```shell
  cd backend
```

Install dependencies

```shell
  npm install
```

Setup database and run migration on postgresql
```shell
  npx prisma migrate dev --create-only
  npx prisma migrate dev
```

Run the seeds:

```shell
npm run seed
```

Now, the last step before being able to start the backend.

```shell
npm run setup
```

That is an special command that does several tweaks in the system, and download ubuntu and fedora isos.
Remember, this is a developer command, is not mend to be executed in final clients.

Start the server

```shell
  npm run start
```


