import { PrismaClient } from '@prisma/client'
import ISOById from '../app/graphql/resolvers/queries/ISOById.js'
import { describe, expect, test } from '@jest/globals'

const prisma = new PrismaClient()

jest.mock('../app/services/isAuthForBoth.js', () => {
  return jest.fn().mockReturnValue({ id: 'e1019b2a-804e-4280-a65d-79791f892207' })
})

describe('ISOById', () => {
  test('getISOById', async () => {
    const mockInput = { input: { userId: 'e1019b2a-804e-4280-a65d-79791f892207' } }
    jest.spyOn(prisma.ISO, 'findMany').mockReturnValueOnce({ userId: 'e1019b2a-804e-4280-a65d-79791f892207' })
    const result = await ISOById.Query.getISOById(null, mockInput)
    expect(result).toEqual([
      {
        id: '2ea6de0f-7ea9-4cc5-bf6a-ca438bc52e02',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'ac375d53-be08-45a7-84a0-ab546b4c2bcd',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '25c1ea60-2a78-41c8-a2e1-5a6bb28d7849',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'eb454536-8856-420f-88ae-c617e78b61a8',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '376008b7-1a47-417b-98fe-8f752668261e',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'aee17f05-8030-41b0-a351-7f93f760cffd',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '72ffc5f6-7f29-4c1c-9def-b7f072c35bc3',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'b6410730-4788-469d-adf8-dbe23d889be6',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '2f620b5d-1093-4ca0-a387-f499ee2b19aa',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '045c4de7-0250-482d-825b-e45f97668a7f',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '60d95660-2e0a-4412-8ca4-3c6529f726f4',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '2b9b8e1f-efcf-4004-83e9-a08c502f5ef7',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '1dc268bd-0a94-4456-891c-68b8095b3ef4',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'ecc94a0f-08a4-4735-bfa2-7329eb063d4b',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '557efba1-97c4-4eec-8f38-40d9bda90c7a',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '4ca74f00-760c-4246-9123-7a600f957e5b',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '735a410f-1428-44ac-9aec-8f3bf3dd9662',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'b8aa8caf-6586-4b29-a3ff-9d6260f1d736',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '86adfd5a-fb0c-4213-b868-bc77082c5722',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'b9189c4d-7b62-471a-971b-6c5341100324',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '7b2c38c5-dca6-4fd7-aa72-6a93596633e1',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '9bec4370-8162-48df-aa37-6a029c665a50',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '4844bbe5-0d54-411f-88ff-2c8a9152fb1b',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '5f329438-c3b8-4856-86f8-eb621ed253ee',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '2695dc8e-0016-489f-939f-8d30c78edd55',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '9378234d-7e5b-4650-b945-190e76bb4e69',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'ccdf628b-0350-4b57-a477-b06ec6f0aacb',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '7b527ea2-cc84-4a81-ba2c-8ddeb1f88ba2',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '7a2eeb87-03fd-4326-b602-c8f614e385f7',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '91252eb8-5034-4bec-acc4-831052378231',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'b81a3fe8-087b-4728-b4db-1ec5f1ebb4c6',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '2a54e6b2-94b3-40ff-ab13-05411dfca896',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '836cc2c9-8414-4806-bbe2-1efa1fda4676',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '1ce97589-ca1f-4817-adbf-3ed31f49925b',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'a0ad050c-a7cc-4d1e-981e-44b032f512c8',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '21f58a52-4fe0-4d48-babe-0750046b659e',
        name: 'newiso.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '7714e351-e16b-4409-86cf-ca5e748b0624',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '68e527d9-742d-4c99-a051-51d64c49fda6',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'fc2e446e-3ef9-431f-beb8-5f0dfdb63c67',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'b4a004b7-2581-4f60-b602-f0a3a7f09d0f',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'ae7f45b2-ae7b-4197-9296-68fa96c0534d',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '96b51a09-f94b-4991-8cd3-f6ef6ae389c3',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '201d4b80-c305-4286-a143-2613afa5c5d4',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '21638156-fa28-411b-a118-08aff1438cf0',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '3354342a-894b-493f-a1c4-2b7d1a673f9e',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'f5a9d1fc-e6d2-40a7-8e78-23085dc12474',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '55343d11-8619-4732-9bbe-f7953dcdbd5a',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '1c6b459c-d45f-4b80-b040-5d342a8ae124',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '6be1bd50-2e0a-482e-8daa-e0871eb9f35b',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '842a4c44-b7ec-4969-a78d-73d7afe5ec10',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '67766f99-d420-40fa-b034-1b356f83aced',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '7ac76c38-2100-4101-ac88-ed7d42cd0332',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '0bf74093-d33e-4b78-9e91-ece64ca210a5',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'd14a4462-621f-414e-83c1-c0aedfe89392',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'f672c389-b0c3-4a8a-bab8-dc4957043e4f',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '9800b0cd-ea2a-4ceb-81aa-53a62283d201',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'adf7652c-a6d6-42b8-a341-c0b6c4cc03f6',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '2f18a10a-13f2-4b66-ac01-766c8c4aaeb6',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '4b1f2902-62e1-4161-8cbd-c16201ed3d45',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '6f8081a5-cc1c-492f-b45a-40b88af15e13',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'c6a76916-4568-49ad-9955-0951e540bdc9',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '22560043-9248-40b6-b652-b409a998d3b3',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '6129e1ee-bfdc-4e71-a6ed-5f9b9fd9c4cb',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'c845c33d-e64b-40e7-9a83-5aa0da91389f',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '467ca707-ca2d-434f-95ce-b5b2901d6f06',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '4981483f-c49a-4915-bc23-1c4c6fdac8d3',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '29120ac7-0073-4199-97d3-997c33a86daa',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '04eaece3-d8ae-47e4-81d6-0865749cd7c8',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'd18ff52d-8694-435a-b43d-9067dbcbc657',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'd53c8f36-b051-429f-9614-425a276e9164',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'e784eaf6-5e11-4011-95e1-e17225463625',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '13630e06-c26f-4d53-bf4a-eabf860d9d64',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '51f093a9-e308-4867-bb7c-665bcb11bc18',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '80680e0a-1d45-45a3-b67c-67e4a94ebfcb',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'e1957785-3dc4-45c2-aeff-134977c6a69c',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'f2a333d0-03da-4519-8e1f-a9d459db14fe',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '494c560f-1dd6-4cf7-8fe6-17a84d1a5e9d',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '46d82abb-9d2d-4090-9112-2ce3976b41e6',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'b02a0359-c943-4aab-87b2-df22b7beb1f4',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '8e8097a5-35a2-4918-989e-f8fc1452c8c8',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '9397566b-b26e-4c30-a381-31ae369fb949',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '10ee9cbb-d337-4867-ad7e-55778c47b873',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '386d48e4-efbb-4c6f-8fdc-52a466ca6ddf',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'bb5664b8-9788-4c21-beca-860ccd6330f2',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '89ed3710-ff22-4cca-99ec-cbbe1cba01db',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '12729214-fb7a-4262-a335-9d8db8fd24bc',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '6421021a-7a27-476f-9074-36e70bb5665f',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '1513e863-8968-4435-b58a-933cc9e3e82d',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '71f4f5c5-730e-43c1-afbc-081ba915031f',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '4f1f9885-07e5-48e2-957e-11adbfb18a53',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '9a9b3230-a78f-47d9-bfdb-12c040ac748e',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '64a04b43-fb50-4f5f-82b0-20a4b5acab55',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '3fde89b5-7059-4ef8-b3e0-e7ef651c1784',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'd16adaef-1aac-42ef-adb4-b15a532e73f3',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '5e93c72f-0ac4-43f9-9343-3bcdfa6aa59b',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '147af97d-c239-445c-89d1-b771cadf9f8e',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '312d96f8-11e5-4b6a-a28d-c7267b047976',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'c6b386b6-6723-4021-bd27-2b5bfbd1cda4',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'c8aa5074-8dff-46cf-a733-70962c6f0182',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '43bfd1ed-d4eb-4e00-8620-78735f02afc1',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '2d0dd8db-59dc-46b2-bd8c-8a9265acfb5f',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '6f069699-cc29-405c-b210-5710310d3b15',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '8a71b587-ba03-476e-b92d-e4833ac5e28d',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '2a463c04-72a5-423f-ae78-e889909df247',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '25e0d52a-38e4-4dd1-875a-b46174cfd34f',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'd6b4c5e6-5853-4ce3-81cd-34f694772443',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '15a38220-7781-4b15-ae8e-1390ae441bd3',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '4bcb79cd-f312-4cdb-8e07-5f56928867bf',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'fbc62688-939f-4a8b-922d-5888b3cef908',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '7babdbac-5793-4ced-ae71-9d459996d229',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '3f9d37f6-387e-4c2d-82e6-0ba53e17d470',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'a4e4bc6f-00e4-4f73-b7b8-b05dacaf1b50',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '0b175424-6bd6-4bdc-9208-159beffafb38',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'fab359d0-8c13-4a53-8a04-9604477f9034',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '5942b161-3ed5-46a0-a6ca-26ae7e2b498b',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '19f47c01-3b30-4582-8dad-a466ea6de6a9',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '40cb2788-2407-4338-ab01-d8fd3c679815',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'ec3db7d5-4374-4ee3-92e4-4bfc10e2d6fe',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '74795719-543a-4522-b039-077d58d2c935',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '270f31ba-8371-49c7-b0c8-a96e04c123d0',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '712aa931-84ff-478f-8203-0161312cbc37',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '6a626231-f977-45c9-adfc-e3dfdbabb24b',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'd7a95946-80aa-46f4-9a21-dc1b293e5a79',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '63d111f3-8830-4d95-b9dc-3879573ee918',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'ae8f8e03-edbf-494c-8e7d-2edccff612f1',
        name: 'newww.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'dd4c9fa7-e432-49fe-91fe-cc965108e320',
        name: 'myiso.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'd136441d-9000-4e20-ad7b-989a3958f2ce',
        name: 'myiso.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'e0f00caf-826a-482b-a918-2d8b3b0b8cdf',
        name: 'new12.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '5f455c3d-1571-465b-934a-c89947987c4c',
        name: 'new12.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '29d641fb-0588-4e70-8762-c0fcd3ea5d56',
        name: 'myy.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '7fc9776b-072e-49f8-b613-3432a2ba042b',
        name: 'myy.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'dec76447-6ffa-43ed-ae86-8bb1aef5f132',
        name: 'apple.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 3
      },
      {

        id: '79d2ad8a-3833-4de7-bb87-9e4c9a156281',
        name: 'oppo.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'dcc6bacf-200f-41a1-b744-3d6cbf36e44a',
        name: 'oppo.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '25d3b5f6-a92c-45fc-bf20-330693704a68',
        name: 'oppo.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '3898eb9d-1232-45ed-b21f-04f713219467',
        name: 'oppo.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '4edfc1ac-bda6-475d-9f3f-14ae9f87e150',
        name: 'oppo.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'c57f00f0-fece-4ba7-b29e-8bff9b06b082',
        name: 'oppo.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '430821d1-c82d-467f-a57b-5b300d6402df',
        name: 'oppo.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '6878c4f0-7a6f-4b20-a554-b7490ed3662a',
        name: 'oppo.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '7446a729-41fc-466a-a268-dc1e6fa20955',
        name: 'oppo.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: 'd726511d-ff40-455b-83b5-fc49d6ebf416',
        name: 'oppo.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '79c1cf71-aa7b-483d-b4d0-1f48f3be8143',
        name: 'appple.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      },
      {

        id: '409a8142-c02e-4b5d-9d7b-7e75cf27e9ce',
        name: 'appple.iso',
        userId: 'e1019b2a-804e-4280-a65d-79791f892207',
        type: 'window',
        size: 2
      }
    ])
  })
  test('should throw an error if the function fails', async () => {
    jest.spyOn(prisma.ISO, 'findMany').mockRejectedValue(new Error('mockError'))
    try {
      await ISOById.Query.getISOById(null)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Please enter valid credentials')
    }
  })
})
