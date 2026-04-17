import 'reflect-metadata'
import { describe, it, expect, beforeEach } from '@jest/globals'
import { NetworkService } from '../../../app/services/networkService'

describe('NetworkService (Deprecated)', () => {
  let networkService: NetworkService

  beforeEach(() => {
    networkService = new NetworkService()
  })

  describe('validateNetworkName', () => {
    it('should throw deprecation error', async () => {
      await expect(networkService.validateNetworkName('test-network'))
        .rejects.toThrow('Libvirt networks are deprecated')
    })
  })

  describe('getAllNetworks', () => {
    it('should return empty array', async () => {
      const result = await networkService.getAllNetworks()
      expect(result).toEqual([])
    })
  })

  describe('getNetwork', () => {
    it('should throw deprecation error with network name', async () => {
      await expect(networkService.getNetwork('test-network'))
        .rejects.toThrow('Libvirt networks are deprecated')
    })
  })

  describe('createNetwork', () => {
    it('should throw deprecation error', async () => {
      await expect(networkService.createNetwork({} as any))
        .rejects.toThrow('Libvirt networks are deprecated')
    })
  })

  describe('deleteNetwork', () => {
    it('should throw deprecation error', async () => {
      await expect(networkService.deleteNetwork('test-network'))
        .rejects.toThrow('Libvirt networks are deprecated')
    })
  })

  describe('setIpRange', () => {
    it('should throw deprecation error', async () => {
      await expect(networkService.setIpRange('net', '192.168.1.100', '192.168.1.200'))
        .rejects.toThrow('Libvirt networks are deprecated')
    })
  })

  describe('validateDhcpRange', () => {
    it('should throw deprecation error', async () => {
      await expect(networkService.validateDhcpRange({
        address: '192.168.1.1',
        netmask: '255.255.255.0'
      })).rejects.toThrow('Libvirt networks are deprecated')
    })
  })
})
