# Changelog

All notable changes to the Infinibay Backend will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **BREAKING**: `VMFirewallSyncService` now generates MD5-based internal filter names via centralized `FilterNameGenerator` utility. Previously, it used substring-based naming (first 8 characters of ID), which caused filter name mismatches with other parts of the system. The new approach uses MD5 hash (truncated to 8 characters) for consistent, deterministic naming across all firewall services.

  **Migration Impact**: Existing VM firewall rule sets created with the old substring-based naming will continue to work, but new rule sets will use the MD5-based format. If external consumers rely on the exact filter name format, they should be updated to use the `FilterNameGenerator.generate()` utility or query the filter name from the database instead of constructing it manually.

  **Example**:
  - Old format: `ibay-vm-12345678` (substring of VM ID)
  - New format: `ibay-vm-a1b2c3d4` (MD5 hash of VM ID)

### Added

- Created centralized `FilterNameGenerator` utility class for consistent firewall filter naming across all services
- Implemented Factory Pattern with Strategy Pattern for firewall filter creation (`FirewallFilterFactory`, `DepartmentFilterStrategy`, `VMFilterStrategy`)
- Added `IFilterStrategy` interface defining contract for filter creation strategies

### Fixed

- Fixed critical bug in `VMFirewallSyncService` where filter names were generated using substring approach instead of MD5 hash, causing mismatches with `NWFilterXMLGeneratorService` and `createMachineService`

### Refactored

- Eliminated three duplicate implementations of filter name generation logic (DRY principle)
- Refactored `NWFilterXMLGeneratorService.generateFilterName()` to delegate to centralized utility
- Refactored `createMachineService.generateInternalFilterName()` to use `RuleSetType` enum instead of string literals
- Improved type safety by replacing string literals with `RuleSetType` enum throughout firewall services
