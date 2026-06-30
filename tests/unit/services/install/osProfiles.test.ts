import 'reflect-metadata'
import { describe, it, expect } from '@jest/globals'
import { resolveOsProfile, installMechanismFor } from '../../../../app/services/install/osProfiles'

/**
 * The distro-agnostic OS catalog: selection is by install MECHANISM, and versioned
 * / rebuild OS strings resolve to the right family.
 */
describe('osProfiles catalog', () => {
  it('maps the canonical OsEnum values to the right mechanism', () => {
    expect(installMechanismFor('ubuntu')).toBe('cloud-init')
    expect(installMechanismFor('fedora')).toBe('kickstart')
    expect(installMechanismFor('windows10')).toBe('autounattend')
    expect(installMechanismFor('windows11')).toBe('autounattend')
  })

  it('resolves versioned strings to the family (ubuntu-22.04 → cloud-init)', () => {
    expect(installMechanismFor('ubuntu-22.04')).toBe('cloud-init')
    expect(installMechanismFor('ubuntu-24.04.4')).toBe('cloud-init')
    expect(resolveOsProfile('ubuntu-22.04')?.family).toBe('ubuntu')
  })

  it('resolves RHEL rebuilds + the legacy redhat alias to kickstart', () => {
    expect(installMechanismFor('fedora')).toBe('kickstart')
    expect(installMechanismFor('redhat')).toBe('kickstart')
    expect(installMechanismFor('rocky9')).toBe('kickstart')
    expect(installMechanismFor('almalinux')).toBe('kickstart')
    expect(resolveOsProfile('rocky9')?.family).toBe('rhel')
  })

  it('handles debian via cloud-init', () => {
    expect(installMechanismFor('debian')).toBe('cloud-init')
    expect(installMechanismFor('debian-12')).toBe('cloud-init')
  })

  it('returns null for unknown / empty', () => {
    expect(resolveOsProfile('')).toBeNull()
    expect(resolveOsProfile(undefined)).toBeNull()
    expect(resolveOsProfile('haiku')).toBeNull()
  })
})
