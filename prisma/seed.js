
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const eMail = 'admin@gmail.com'
const firstName = 'admin'
const lastName = ''
const userType = 'user'
const password = '$2b$10$bnlDs5CVQQVEAfVxRWZC/udquZX6pO11ixTlfmYkxkv4ujLHmjawK'
const deleted = false
const id = '8fcca9c6-8d8a-43d5-a1f9-5fdacbde289e'
const userImage = 'app/userImage/33k.jpeg'

const data = [userImage, id, eMail, firstName, lastName, userType, password, deleted]

function seedUser () {
  Promise.all(
    data.map((n) => prisma.user.create({ data: n }))
  )
    .then(() => console.info('[SEED] Successfully create user records'))
    .catch((e) => console.error('[SEED] Failed to create user records', e))
}

seedUser()
