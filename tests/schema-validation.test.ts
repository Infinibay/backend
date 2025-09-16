import 'reflect-metadata'
import { describe, it, expect } from '@jest/globals'
import { readFileSync } from 'fs'
import path from 'path'

describe('GraphQL Schema Validation', () => {
  const schemaPath = path.resolve(__dirname, '../app/schema.graphql')
  let schemaContent: string

  beforeAll(() => {
    schemaContent = readFileSync(schemaPath, 'utf-8')
  })

  describe('Required Queries', () => {
    it('should contain getVMRecommendations query', () => {
      expect(schemaContent).toContain('getVMRecommendations(')
    })

    it('should contain VMRecommendationType definition', () => {
      expect(schemaContent).toContain('type VMRecommendationType')
    })

    it('should contain RecommendationType enum', () => {
      expect(schemaContent).toContain('enum RecommendationType')
    })

    it('should contain RecommendationFilterInput', () => {
      expect(schemaContent).toContain('input RecommendationFilterInput')
    })
  })

  describe('Query Structure Validation', () => {
    it('should have properly structured getVMRecommendations query', () => {
      const queryMatch = schemaContent.match(/getVMRecommendations\([^)]+\): \[VMRecommendationType!\]!/)
      expect(queryMatch).toBeTruthy()
    })

    it('should include required parameters for getVMRecommendations', () => {
      const querySection = schemaContent.substring(
        schemaContent.indexOf('getVMRecommendations('),
        schemaContent.indexOf('): [VMRecommendationType!]!')
      )

      expect(querySection).toContain('vmId: ID!')
      expect(querySection).toContain('refresh: Boolean')
      expect(querySection).toContain('filter: RecommendationFilterInput')
    })
  })

  describe('Type Completeness', () => {
    it('should have all required VMRecommendationType fields', () => {
      const typeSection = schemaContent.substring(
        schemaContent.indexOf('type VMRecommendationType'),
        schemaContent.indexOf('}', schemaContent.indexOf('type VMRecommendationType'))
      )

      const requiredFields = ['id: ID!', 'machineId: ID!', 'type: RecommendationType!', 'text: String!', 'actionText: String!', 'createdAt: DateTimeISO!']

      requiredFields.forEach(field => {
        expect(typeSection).toContain(field)
      })
    })

    it('should have all RecommendationType enum values', () => {
      const enumSection = schemaContent.substring(
        schemaContent.indexOf('enum RecommendationType'),
        schemaContent.indexOf('}', schemaContent.indexOf('enum RecommendationType'))
      )

      const requiredEnumValues = [
        'DISK_SPACE_LOW',
        'OVER_PROVISIONED',
        'UNDER_PROVISIONED',
        'OS_UPDATE_AVAILABLE',
        'APP_UPDATE_AVAILABLE',
        'DEFENDER_DISABLED',
        'DEFENDER_THREAT',
        'HIGH_CPU_APP',
        'HIGH_RAM_APP',
        'PORT_BLOCKED',
        'OTHER'
      ]

      requiredEnumValues.forEach(enumValue => {
        expect(enumSection).toContain(enumValue)
      })
    })
  })

  describe('Documentation Presence', () => {
    it('should have query documentation', () => {
      const queryDocPattern = /"""[^"]*Get automated recommendations[^"]*"""/
      expect(schemaContent).toMatch(queryDocPattern)
    })

    it('should have enum documentation', () => {
      const enumDocPattern = /"""[^"]*Types of VM recommendations[^"]*"""/
      expect(schemaContent).toMatch(enumDocPattern)
    })

    it('should have type documentation', () => {
      const typeDocPattern = /"""[^"]*automated recommendation[^"]*"""/
      expect(schemaContent).toMatch(typeDocPattern)
    })
  })
})