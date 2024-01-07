import * as ffi from 'ffi-napi';
import ref from 'ref-napi';
import { spawn } from 'child_process';
import ArrayType from 'ref-array-napi';
import { DOMParser, XMLSerializer } from 'xmldom';
import { parseStringPromise } from 'xml2js';

import { Debugger } from './debug';


const voidPtr = ref.refType(ref.types.void);
const charPtr = ref.refType('char')
const charPtrArray = ArrayType(charPtr)

// https://libvirt.org/html/libvirt-libvirt-domain.html#virDomainInfoPtr
// const VirDomainInfo = StructType({
//   state: 'uchar',        // unsigned char
//   maxMem: 'ulong',       // unsigned long
//   memory: 'ulong',       // unsigned long
//   nrVirtCpu: 'ushort',   // unsigned short
//   cpuTime: 'ulonglong'   // unsigned long long
// });

// const virDomainInfoPtr = ref.refType(VirDomainInfo);

export enum virDomainModificationImpact {
  VIR_DOMAIN_AFFECT_CURRENT = 0, /* Affect current domain state. */
  VIR_DOMAIN_AFFECT_LIVE = 1 << 0, /* Affect running domain state. */
  VIR_DOMAIN_AFFECT_CONFIG = 1 << 1 /* Affect persistent domain state. */
}

export enum VirDomainState {
  VIR_DOMAIN_NOSTATE = 0,     /* no state */
  VIR_DOMAIN_RUNNING = 1,     /* the domain is running */
  VIR_DOMAIN_BLOCKED = 2,     /* the domain is blocked on resource */
  VIR_DOMAIN_PAUSED = 3,      /* the domain is paused by user */
  VIR_DOMAIN_SHUTDOWN = 4,    /* the domain is being shut down */
  VIR_DOMAIN_SHUTOFF = 5,     /* the domain is shut off */
  VIR_DOMAIN_CRASHED = 6,     /* the domain is crashed */
  VIR_DOMAIN_PMSUSPENDED = 7, /* the domain is suspended by guest power management */
  VIR_DOMAIN_LAST = 8,        /* the last state */
}

// Define the enumeration for the libvirt error codes
enum LibvirtErrorCodes {
  VIR_ERR_OK = 0,
  VIR_ERR_INTERNAL_ERROR = 1,
  VIR_ERR_NO_MEMORY = 2,
  VIR_ERR_NO_SUPPORT = 3,
  VIR_ERR_UNKNOWN_HOST = 4,
  VIR_ERR_NO_CONNECT = 5,
  VIR_ERR_INVALID_CONN = 6,
  VIR_ERR_INVALID_DOMAIN = 7,
  VIR_ERR_INVALID_ARG = 8,
  VIR_ERR_OPERATION_FAILED = 9,
  VIR_ERR_GET_FAILED = 10,
  VIR_ERR_POST_FAILED = 11,
  VIR_ERR_HTTP_ERROR = 12,
  VIR_ERR_SEXPR_SERIAL = 13,
  VIR_ERR_NO_XEN = 14,
  VIR_ERR_XEN_CALL = 15,
  VIR_ERR_OS_TYPE = 16,
  VIR_ERR_NO_KERNEL = 17,
  VIR_ERR_NO_ROOT = 18,
  VIR_ERR_NO_SOURCE = 19,
  VIR_ERR_NO_TARGET = 20,
  VIR_ERR_NO_NAME = 21,
  VIR_ERR_NO_OS = 22,
  VIR_ERR_NO_DEVICE = 23,
  VIR_ERR_NO_XENSTORE = 24,
  VIR_ERR_DRIVER_FULL = 25,
  VIR_ERR_CALL_FAILED = 26,
  VIR_ERR_XML_ERROR = 27,
  VIR_ERR_DOM_EXIST = 28,
  VIR_ERR_OPERATION_DENIED = 29,
  VIR_ERR_OPEN_FAILED = 30,
  VIR_ERR_READ_FAILED = 31,
  VIR_ERR_PARSE_FAILED = 32,
  VIR_ERR_CONF_SYNTAX = 33,
  VIR_ERR_WRITE_FAILED = 34,
  VIR_ERR_XML_DETAIL = 35,
  VIR_ERR_INVALID_NETWORK = 36,
  VIR_ERR_NETWORK_EXIST = 37,
  VIR_ERR_SYSTEM_ERROR = 38,
  VIR_ERR_RPC = 39,
  VIR_ERR_GNUTLS_ERROR = 40,
  VIR_WAR_NO_NETWORK = 41,
  VIR_ERR_NO_DOMAIN = 42,
  VIR_ERR_NO_NETWORK = 43,
  VIR_ERR_INVALID_MAC = 44,
  VIR_ERR_AUTH_FAILED = 45,
  VIR_ERR_INVALID_STORAGE_POOL = 46,
  VIR_ERR_INVALID_STORAGE_VOL = 47,
  VIR_ERR_NO_STORAGE_VOL = 48,
  VIR_ERR_INVALID_NODE = 49,
  VIR_ERR_INVALID_NETWORK_PORT = 50,
  VIR_ERR_NO_NETWORK_PORT = 51,
  VIR_ERR_NO_NODE = 52,
  VIR_ERR_INVALID_CAPABILITIES = 53,
  VIR_ERR_CAPABILITIES = 54,
  VIR_ERR_XML_INVALID_SCHEMA = 55,
  VIR_ERR_INVALID_JOB = 56,
  VIR_ERR_INVALID_JOB_TYPE = 57,
  VIR_ERR_JOB_TIMEOUT = 58,
  VIR_ERR_CALL_TIMEOUT = 59,
  VIR_ERR_JSON_PARSE = 60,
  VIR_ERR_PID = 61,
  VIR_ERR_INVALID_ISCSI = 62,
  VIR_ERR_NO_ISCSI = 63,
  VIR_ERR_AUTH = 64,
  VIR_ERR_INVALID_SECRET = 65,
  VIR_ERR_NO_SECRET = 66,
  VIR_ERR_CONFIG_UNSUPPORTED = 67,
  VIR_ERR_OPERATION_UNSUPPORTED = 68,
  VIR_ERR_NO_NWFILTER = 69,
  VIR_ERR_BUILD_FIREWALL = 70,
  VIR_ERR_HW = 71,
  VIR_ERR_TRAFFIC_CLASS = 72,
  VIR_ERR_INVALID_NWFILTER = 73,
  VIR_ERR_NO_DOMAIN_SNAPSHOT = 74,
  VIR_ERR_INVALID_DOMAIN_SNAPSHOT = 75,
  VIR_ERR_NO_NWFILTER_BINDING = 76,
  VIR_ERR_INVALID_NWFILTER_BINDING = 77,
  VIR_ERR_NO_DOMAIN_CHECKPOINT = 78,
  VIR_ERR_INVALID_DOMAIN_CHECKPOINT = 79,
  VIR_ERR_NO_SAVE_IMAGE = 80,
  VIR_ERR_INVALID_SAVE_IMAGE = 81,
  VIR_ERR_NO_CAPABILITY = 82,
  VIR_ERR_INVALID_QUEUE = 83,
  VIR_ERR_NO_DOMAIN_BACKUP = 84,
  VIR_ERR_INVALID_DOMAIN_BACKUP = 85,
  VIR_ERR_MISSING_VALUE = 86,
  VIR_ERR_INVALID_SENSOR = 87,
  VIR_ERR_NO_SENSOR = 88,
  VIR_ERR_NO_HOST_CHECKPOINT = 89,
  VIR_ERR_INVALID_HOST_CHECKPOINT = 90,
  VIR_ERR_NOT_ANON_INPLACE = 91,
  VIR_ERR_INVALID_EVENT = 92,
  VIR_ERR_NO_EVENT = 93,
  VIR_ERR_INVALID_HOSTDEV = 94,
  VIR_ERR_NO_HOSTDEV = 95,
  VIR_ERR_QUIC = 96,
  VIR_ERR_INVALID_DOMAIN_COREDUMP = 97,
  VIR_ERR_NO_DOMAIN_COREDUMP = 98,
  VIR_ERR_INVALID_DRIVER = 99,
  VIR_ERR_NO_INTERFACE = 100,
  VIR_ERR_INVALID_INTERFACE = 101,
  VIR_ERR_NO_NAMED = 102,
  VIR_ERR_INVALID_NAMED = 103,
  VIR_ERR_INVALID_RESCTRL = 104,
  VIR_ERR_NO_RESCTRL = 105,
  VIR_ERR_INVALID_IP = 106,
  VIR_ERR_INVALID_ISCSI_DIRECT = 107,
  VIR_ERR_INVALID_HOSTDEV_SUBSYS = 108,
  VIR_ERR_INVALID_HOSTDEV_PCI = 109,
  VIR_ERR_INVALID_HOSTDEV_USB = 110,
  VIR_ERR_INVALID_HOSTDEV_SCSI = 111,
  VIR_ERR_INVALID_HOSTDEV_SCSI_HOST = 112,
  // Add more error codes as needed
}

// Define the custom error class
class LibvirtError extends Error {
    constructor(libvirtErrorCode: LibvirtErrorCodes) {
      let message: string;
  
      switch (libvirtErrorCode) {
        case LibvirtErrorCodes.VIR_ERR_OK:
          message = 'No error';
          break;
        case LibvirtErrorCodes.VIR_ERR_INTERNAL_ERROR:
          message = 'Internal error';
          break;
        case LibvirtErrorCodes.VIR_ERR_NO_MEMORY:
          message = 'Memory allocation failure';
          break;
        case LibvirtErrorCodes.VIR_ERR_NO_CONNECT:
          message = 'Failed to connect';
          break;
        case LibvirtErrorCodes.VIR_ERR_NO_DOMAIN:
          message = 'Failed to find the domain';
          break;
        case LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED:
          message = 'Operation failed';
          break;
        case LibvirtErrorCodes.VIR_ERR_INVALID_ARG:
          message = 'Invalid argument';
          break;
        case LibvirtErrorCodes.VIR_ERR_NO_NETWORK:
          message = 'Failed to find the network';
          break;
        default:
          message = 'Unknown error';
      }
  
      super(message);
      this.name = 'LibvirtError';
    }
  }

/**
 * The Libvirt class provides a wrapper around the libvirt library, allowing
 * you to manage virtual machines and their resources.
 *
 * @example
 * const libvirt = new Libvirt();
 * 
 * // Connect to the hypervisor
 * libvirt.connect('qemu:///system');
 * 
 * // Create a storage pool
 * const poolXml = `<pool>...</pool>`; // Replace with your pool XML
 * libvirt.createStoragePool(poolXml);
 * 
 * // Create a storage volume
 * const volumeXml = `<volume>...</volume>`; // Replace with your volume XML
 * libvirt.createDisk('my-pool', volumeXml);
 * 
 * // Define a domain
 * const domainXml = `<domain>...</domain>`; // Replace with your domain XML
 * libvirt.domainDefineXML(domainXml);
 * 
 * // Power on the domain
 * libvirt.powerOn('my-domain');
 * 
 * // Check the domain status
 * console.log(libvirt.getDomainStatus('my-domain')); // 'Running'
 * 
 * // Suspend the domain
 * libvirt.suspend('my-domain');
 * 
 * // Power on the domain again
 * libvirt.powerOn('my-domain');
 * 
 * // Power off the domain
 * libvirt.powerOff('my-domain');
 * 
 * // Disconnect from the hypervisor
 * libvirt.disconnect();
 */
export class Libvirt {
  private libvirt: any;
  private connection: Buffer | null = null;
  private debug: Debugger = new Debugger('libvirt');

  constructor() {
    this.debug.log('Opening libvirt.so');
    // Load the Libvirt library
    this.libvirt = new ffi.Library('libvirt.so', {
      // Map the Libvirt functions
      'virConnectOpen': ['pointer', ['string']],
      'virConnectClose': ['int', ['pointer']],
      'virDomainLookupByName': ['pointer', ['pointer', 'string']],
      'virDomainCreate': ['int', ['pointer']],
      'virDomainDestroy': ['int', ['pointer']],
      'virDomainDefineXML': ['pointer', ['pointer', 'string']],
      'virDomainUndefine': ['int', ['pointer']], // Add this line
      'virDomainUpdateDeviceFlags': ['int', ['pointer', 'string', 'int']], // Add this line
      'virStoragePoolLookupByName': ['pointer', ['pointer', 'string']],
      'virStorageVolCreateXML': ['pointer', ['pointer', 'string', 'int']],
      'virStoragePoolDefineXML': ['pointer', ['pointer', 'string', 'int']],
      'virStoragePoolCreate': ['int', ['pointer', 'int']],
      'virNetworkDefineXML': ['pointer', ['pointer', 'string']],
      'virNetworkCreate': ['int', ['pointer']],
      'virNetworkLookupByName': ['pointer', ['pointer', 'string']],
      'virDomainAttachDevice': ['int', ['pointer', 'string']],
      'virDomainGetXMLDesc': ['string', ['pointer', 'int']], // Add this line
      'virConnectListAllDomains': ['int', ['pointer', 'pointer', 'int']],
      'virConnectListDefinedDomains': ['int', ['pointer', 'pointer', 'int']],
      'virDomainGetInfo': ['int', ['pointer', 'pointer']],
      'virDomainGetName': ['string', ['pointer']],
      'virDomainGetState': ['int', ['pointer', 'pointer', 'pointer', 'uint']],
      // Add more functions as needed
    });
  }

  /**
   * This method establishes a connection to the hypervisor.
   * 
   * @param {string} uri - The URI of the hypervisor to connect to.
   * @returns {Buffer | null} - A buffer representing the connection, or null if the connection fails.
   * @throws {LibvirtError} - Throws an error if the connection fails.
   */
  public connect(uri: string): Buffer | null {
    this.debug.log('Connecting to hypervisor');
    this.connection = this.libvirt.virConnectOpen(uri);
  
    if (this.connection && this.connection.isNull()) {
      this.debug.log('error', 'Failed to connect to hypervisor');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
    }

    this.debug.log('Connected to hypervisor');
    return this.connection;
  }

  /**
   * This method checks if there is an active connection to the hypervisor.
   * 
   * @returns {boolean} - Returns true if there is an active connection, false otherwise.
   */
  public isConnected(): boolean {
    return this.connection !== null && !this.connection.isNull();
  }

  /**
   * This method closes the connection to the hypervisor.
   * 
   * @throws {LibvirtError} - Throws an error if the operation fails.
   */
  public close(): void {
    this.debug.log('Closing connection to hypervisor');
    if (this.connection) {
      const result = this.libvirt.virConnectClose(this.connection);
      this.debug.log('Closed connection to hypervisor');

      if (result < 0) {
        this.debug.log('error', 'Failed to close connection to hypervisor');
        throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_INTERNAL_ERROR);
      }

      this.connection = null;
    }
  }

  /**
   * This method disconnects from the hypervisor by closing the connection.
   */
  public disconnect(): void {
    this.close();
  }

  /**
   * This method looks up a domain by its name.
   * 
   * @param {string} name - The name of the domain to look up.
   * @returns {Buffer} - A buffer representing the domain.
   * @throws {LibvirtError} - Throws an error if the domain does not exist.
   */
  public domainLookupByName(name: string): Buffer {
    this.debug.log('Looking up domain by name', name);
    const domain = this.libvirt.virDomainLookupByName(this.connection, name);

    if (domain.isNull()) {
      this.debug.log('error', 'Failed to find the domain');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_DOMAIN);
    }

    return domain;
  }

  /**
   * This method creates (starts) a domain.
   * 
   * @param {Buffer} domain - A buffer representing the domain to be created.
   * @returns {number} - Returns 0 on success, -1 in case of error.
   * @throws {LibvirtError} - Throws an error if the operation fails.
   */
  public domainCreate(domain: string): number {
    this.debug.log('Starting VM', domain);
    const domainBuffer = this.libvirt.virDomainLookupByName(this.connection, domain);
    this.debug.log('VM Obtained');
    const result = this.libvirt.virDomainCreate(domainBuffer);
    this.debug.log('VM Started', result);

    if (result < 0) {
      this.debug.log('error', 'Failed to start VM');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }

    return result;
  }

  /**
   * This method destroys a domain.
   * 
   * @param {Buffer} domain - A buffer representing the domain to be destroyed.
   * @returns {number} - Returns 0 on success, -1 in case of error.
   * @throws {LibvirtError} - Throws an error if the operation fails.
   */
  public domainDestroy(domain: string): number {
    this.debug.log('Destroying VM', domain);
    const domainBuffer = this.libvirt.virDomainLookupByName(this.connection, domain);
    this.debug.log('VM Obtained');
    const result = this.libvirt.virDomainDestroy(domainBuffer);
    this.debug.log('VM Destroyed', result);

    if (result < 0) {
      this.debug.log('error', 'Failed to destroy VM');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }

    return result;
  }

  /**
   * This method undefines a domain, effectively deleting it.
   * 
   * @param {string} domain - The name of the domain to be undefined.
   * @returns {number} - Returns 0 on success, -1 in case of error.
   * @throws {LibvirtError} - Throws an error if the operation fails.
   */
  public domainUndefine(domain: string): number {
    this.debug.log('Undefining VM', domain);
    const domainBuffer = this.libvirt.virDomainLookupByName(this.connection, domain);
    this.debug.log('VM Obtained');
    const result = this.libvirt.virDomainUndefine(domainBuffer);
    this.debug.log('VM Undefined', result);
  
    if (result < 0) {
      this.debug.log('error', 'Failed to undefine VM');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
  
    return result;
  }

  /**
   * This method defines a domain from an XML string.
   * 
   * @param {string} xml - The XML string defining the domain.
   * @returns {Buffer} - A buffer representing the defined domain.
   * @throws {LibvirtError} - Throws an error if the domain definition is invalid.
   */
  public domainDefineXML(xml: string): Buffer {
    this.debug.log('Defining domain from XML', xml);
    const domain = this.libvirt.virDomainDefineXML(this.connection, xml);

    if (domain.isNull()) {
      this.debug.log('error', 'Failed to define domain from XML');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_INVALID_ARG);
    }

    return domain;
  }

  /**
   * This method updates a domain with a new XML configuration.
   * 
   * @param {string} name - The name of the domain to be updated.
   * @param {string} newXml - The new XML configuration for the domain.
   * @returns {Buffer} - A buffer representing the updated domain.
   * @throws {LibvirtError} - Throws an error if the domain does not exist, if the new XML configuration is invalid, or if the operation fails.
   */
  public updateDomain(name: string, newXml: string): Buffer {
    this.debug.log('Updating domain', name, newXml);
    // Lookup the domain by its name
    const domain = this.domainLookupByName(name);

    this.debug.log('Undefining the old domain');
    // Undefine the old domain
    const undefineResult = this.libvirt.virDomainUndefine(domain);
    if (undefineResult < 0) {
      this.debug.log('error', 'Failed to undefine the old domain');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_INTERNAL_ERROR);
    }

    this.debug.log('Defining a new domain with the updated XML');
    // Define a new domain with the updated XML
    const newDomain = this.domainDefineXML(newXml);
    return newDomain;
  }

  /**
   * This method powers on a domain or resumes it if it's suspended.
   * 
   * @param {string} name - The name of the domain to be powered on or resumed.
   * @throws {LibvirtError} - Throws an error if the operation fails.
   */
  public powerOn(name: string): void {
    this.debug.log('Powering on domain', name);
    const domain = this.domainLookupByName(name);
    const state = this.getDomainStatus(name);

    this.debug.log('Domain state', state);
    let result;
    if (state === 'Paused') {
      this.debug.log('Domain is paused, resuming');
      result = this.libvirt.virDomainResume(domain);
    } else {
      this.debug.log('Domain is not paused, creating');
      result = this.libvirt.virDomainCreate(domain);
    }

    if (result < 0) {
      this.debug.log('error', 'Failed to power on domain');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
    this.debug.log('Domain powered on successfully');
  }

  // alias methos
  public resume = this.powerOn;

  /**
   * This method powers off a domain.
   * 
   * @param {string} name - The name of the domain to be powered off.
   * @throws {LibvirtError} - Throws an error if the operation fails.
   */
  public powerOff(name: string): void {
    this.debug.log('Powering off domain', name);
    const domain = this.domainLookupByName(name);
    this.debug.log('Domain obtained');
    const result = this.libvirt.virDomainDestroy(domain);
    this.debug.log('Domain destroy result', result);
  
    if (result < 0) {
      this.debug.log('error', 'Failed to power off domain');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
    this.debug.log('Domain powered off successfully');
  }

  /**
   * This method suspends a domain.
   * 
   * @param {string} name - The name of the domain to be suspended.
   * @throws {LibvirtError} - Throws an error if the operation fails.
   */
  public suspend(name: string): void {
    this.debug.log('Suspending domain', name);
    const domain = this.domainLookupByName(name);
    this.debug.log('Domain obtained');
    const result = this.libvirt.virDomainSuspend(domain);
    this.debug.log('Domain suspend result', result);
  
    if (result < 0) {
      this.debug.log('error', 'Failed to suspend domain');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
    this.debug.log('Domain suspended successfully');
  }

  /**
   * This method retrieves the status of a domain.
   * 
   * @param {string} name - The name of the domain.
   * @returns {string} - The status of the domain. Possible values are 'Running', 'Blocked', 'Paused', 'Shutdown', 'Shutoff', 'Crashed', 'PMSuspended', and 'Unknown'.
   * @throws {LibvirtError} - Throws an error if the operation fails.
   */
  public getDomainStatus(name: string): string {
    this.debug.log('Getting domain status', name);
    const domain = this.domainLookupByName(name);
    this.debug.log('Domain obtained');

    // Create ref objects for state and reason
    const state = ref.alloc('int');
    const reason = ref.alloc('int');

    const result = this.libvirt.virDomainGetState(domain, state, reason, 0);

    if (result < 0) {
      this.debug.log('error', 'Failed to get domain state');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }

    // Dereference the state ref object to get its value
    let status: string;
    switch (state.deref()) {
      case 1:
        status = 'Running';
        break;
      case 2:
        status = 'Blocked';
        break;
      case 3:
        status = 'Paused';
        break;
      case 4:
        status = 'Shutdown';
        break;
      case 5:
        status = 'Shutoff';
        break;
      case 6:
        status = 'Crashed';
        break;
      case 7:
        status = 'PMSuspended';
        break;
      default:
        status = 'Unknown';
    }
    this.debug.log('Domain status', status);
    return status;
  }

  /**
   * This method creates a disk in a specified storage pool from an XML string.
   * 
   * @param {string} poolName - The name of the storage pool where the disk will be created.
   * @param {string} xml - The XML string defining the disk.
   * @returns {Buffer} - A buffer representing the created disk.
   * @throws {LibvirtError} - Throws an error if the disk definition is invalid or if the operation fails.
   */
  public createDisk(poolName: string, xml: string): Buffer {
    this.debug.log('Creating disk in pool', poolName, 'with XML');
    // Lookup the storage pool by its name
    const pool = this.libvirt.virStoragePoolLookupByName(this.connection, poolName);
    this.debug.log('Storage pool obtained');

    // Create the storage volume
    const volume = this.libvirt.virStorageVolCreateXML(pool, xml, 0);
    this.debug.log('Storage volume created');

    if (volume.isNull()) {
      this.debug.log('error', 'Failed to create storage volume');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }

    this.debug.log('Disk created successfully');
    return volume;
  }

  /**
   * This method creates a storage pool from an XML string.
   * 
   * @param {string} xml - The XML string defining the storage pool.
   * @returns {Buffer} - A buffer representing the created storage pool.
   * @throws {LibvirtError} - Throws an error if the storage pool definition is invalid or if the operation fails.
   */
  public createStoragePool(xml: string): Buffer {
    this.debug.log('Defining storage pool from XML', xml);
    // Define the storage pool
    const pool = this.libvirt.virStoragePoolDefineXML(this.connection, xml, 0);

    if (pool.isNull()) {
      this.debug.log('error', 'Failed to define storage pool from XML');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
    this.debug.log('Storage pool defined successfully');

    // Create (start) the storage pool
    this.debug.log('Creating storage pool');
    const result = this.libvirt.virStoragePoolCreate(pool, 0);

    if (result < 0) {
      this.debug.log('error', 'Failed to create storage pool');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
    this.debug.log('Storage pool created successfully');

    return pool;
  }

  /**
   * This method creates a network from an XML string.
   * 
   * @param {string} xml - The XML string defining the network.
   * @returns {Buffer} - A buffer representing the created network.
   * @throws {LibvirtError} - Throws an error if the network definition is invalid or if the operation fails.
   */
  public createNetwork(xml: string): Buffer {
    this.debug.log('Defining network from XML', xml);
    // Define the network
    const network = this.libvirt.virNetworkDefineXML(this.connection, xml);
  
    if (network.isNull()) {
      this.debug.log('error', 'Failed to define network from XML');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
    this.debug.log('Network defined successfully');
  
    // Create (start) the network
    this.debug.log('Creating network');
    const result = this.libvirt.virNetworkCreate(network);
  
    if (result < 0) {
      this.debug.log('error', 'Failed to create network');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
    this.debug.log('Network created successfully');
  
    return network;
  }
  
  /**
   * This method adds a domain to a network.
   * 
   * @param {string} domainName - The name of the domain to be added.
   * @param {string} networkName - The name of the network to which the domain will be added.
   * @throws {LibvirtError} - Throws an error if the network does not exist or if the operation fails.
   */
  public addDomainToNetwork(domainName: string, networkName: string): void {
    this.debug.log('Adding domain to network', domainName, networkName);
    const domain = this.domainLookupByName(domainName);
    this.debug.log('Domain obtained');
    const network = this.libvirt.virNetworkLookupByName(this.connection, networkName);
    this.debug.log('Network obtained');
  
    if (network.isNull()) {
      this.debug.log('error', 'Network not found');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_NETWORK);
    }
  
    const result = this.libvirt.virDomainAttachDevice(domain, `<interface type='network'><source network='${networkName}'/></interface>`);
    this.debug.log('Domain attach device result', result);
  
    if (result < 0) {
      this.debug.log('error', 'Failed to add domain to network');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
    this.debug.log('Domain added to network successfully');
  }

  /**
   * This method removes a domain from a network.
   * 
   * @param {string} domainName - The name of the domain to be removed.
   * @param {string} networkName - The name of the network from which the domain will be removed.
   * @throws {LibvirtError} - Throws an error if the network does not exist or if the operation fails.
   */
  public removeDomainFromNetwork(domainName: string, networkName: string): void {
    this.debug.log('Removing domain from network', domainName, networkName);
    const domain = this.domainLookupByName(domainName);
    this.debug.log('Domain obtained');
    const network = this.libvirt.virNetworkLookupByName(this.connection, networkName);
    this.debug.log('Network obtained');
  
    if (network.isNull()) {
      this.debug.log('error', 'Network not found');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_NETWORK);
    }
  
    const result = this.libvirt.virDomainDetachDevice(domain, `<interface type='network'><source network='${networkName}'/></interface>`);
    this.debug.log('Domain detach device result', result);
  
    if (result < 0) {
      this.debug.log('error', 'Failed to remove domain from network');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
    this.debug.log('Domain removed from network successfully');
  }
  
  /**
   * This method retrieves the networks associated with a given domain.
   * 
   * @param {string} domainName - The name of the domain.
   * @returns {string[]} - An array of network names associated with the domain.
   */
  public getDomainNetworks(domainName: string): string[] {
    this.debug.log('Getting domain networks', domainName);
    const domain = this.domainLookupByName(domainName);
    this.debug.log('Domain obtained');
    const xml = this.libvirt.virDomainGetXMLDesc(domain, 0);
    this.debug.log('Domain XML description obtained');
    const xmlDoc = new DOMParser().parseFromString(xml, 'text/xml');
    this.debug.log('XML document parsed');
    const interfaces = xmlDoc.getElementsByTagName('interface');
    this.debug.log('Interfaces obtained');

    const networks = Array.from(interfaces)
        .map((iface: any) => iface.getElementsByTagName('source')[0])
        .filter((source: Element | null) => source && source.getAttribute('network'))
        .map((source: Element) => source.getAttribute('network') as string);
    this.debug.log('Networks obtained', networks.join(', '));

    return networks;
  }

  async domainSetBootloader(domainName: string, isoPath: string): Promise<void> {
    this.debug.log('Setting bootloader for domain', domainName, 'with ISO path', isoPath);
    // const domainNameBuffer = Buffer.from(domainName +'\0', 'utf-8');
    // Fetch the domain's XML definition
    const domain = this.domainLookupByName(domainName);
    const xml = this.libvirt.virDomainGetXMLDesc(domain, 0);
  
    // Parse the XML
    let xmlDoc = new DOMParser().parseFromString(xml, 'text/xml');
  
    // Find the <os> element
    let osElement = xmlDoc.getElementsByTagName('os')[0];
  
    //

    // Create a new <boot> element
    const bootElement = xmlDoc.createElement('boot');
    bootElement.setAttribute('dev', 'cdrom');
    // bootElement.setAttribute('order', '1');  // Boot order 1 is the first device to try. It does not start on 0
  
    // Append the <boot> element to the <os> element
    if (osElement.hasChildNodes()) {
      osElement.insertBefore(bootElement, osElement.firstChild);
    } else {
        // If targetNode has no children, appendChild will work like prepend
        osElement.appendChild(bootElement);
    }
  
    // Serialize the modified XML
    const newXml = new XMLSerializer().serializeToString(xmlDoc);
    this.debug.log('Modified XML serialized');
  
    // Redefine the domain with the modified XML
    this.libvirt.virDomainDefineXML(domain, Buffer.from(newXml + '\0', 'utf-8'));
    this.debug.log('Domain redefined with modified XML');

    const diskXml = `<disk type='file' device='disk'>
      <driver name='qemu' type='raw'/>
      <source file='${isoPath}'/>
      <target dev='hda' bus='ide'/>
      <address type='drive' controller='0' bus='0' target='0' unit='0'/>
    </disk>`;

    // Set the ISO path for the domain's CDROM device
    // This method overwrite ONLY the given devices, in this case, the cdroom
    const deviceAdded = this.libvirt.virDomainUpdateDeviceFlags(domain, 
                Buffer.from(diskXml + '\0', 'utf-8'), 
                virDomainModificationImpact.VIR_DOMAIN_AFFECT_CONFIG);

    if (deviceAdded < 0) {
      this.debug.log('error', 'Failed to set ISO path for domain\'s CDROM device');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    } else {
      this.debug.log('ISO path set for domain\'s CDROM device', deviceAdded);
    }
    

    // Reload the xml
    xmlDoc = new DOMParser().parseFromString(xml, 'text/xml');
    this.debug.log('XML document reloaded');
  }

  public listAllDomains(): string[] {
    // Get the number of domains
    const numDomains = this.libvirt.virConnectNumOfDomains(this.connection);

    // Allocate memory for the names
    const namesPtr = new charPtrArray(numDomains);

    // Get the domain names
    const result = this.libvirt.virConnectListDefinedDomains(this.connection, namesPtr, numDomains);

    if (result < 0) {
        throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }

    // Convert the names to a JavaScript array
    const names = [];
    for (let i = 0; i < numDomains; i++) {
        const name: any = namesPtr[i];
        if (name.isNull()) {
            break;
        }
        const string = ref.readCString(name);
        names.push(string);
    }

    return names;
  }

  lookupDomainByName(name: string): string {
    return this.libvirt.virDomainLookupByName(this.connection, name).toString();
  }

  domainGetInfo(name: string): any {
    const domain = this.domainLookupByName(name);
    const info: any = {}
    const result = this.libvirt.virDomainGetInfo(domain, info.ref());
  
    if (result < 0) {
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
  
    // Convert the returned struct to a JavaScript object
    const infoObject: any = {
      state: info.state,
      maxMem: info.maxMem,
      memory: info.memory,
      nrVirtCpu: info.nrVirtCpu,
      cpuTime: info.cpuTime,
    };
  
    return infoObject;
  }

  createStorage(size: number, fileName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const cmd = 'qemu-img';
      const args = ['create', '-f', 'qcow2', fileName, `${size}G`];
      const childProcess = spawn(cmd, args);
  
      childProcess.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
      });
  
      childProcess.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
      });
  
      childProcess.on('error', (error) => {
        console.error(`exec error: ${error}`);
        reject(error);
      });
  
      childProcess.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`qemu-img process exited with code ${code}`));
        } else {
          resolve();
        }
      });
    });
  }

  async getVncPort(domainName: string): Promise<number> {
    this.debug.log(`Getting VNC port for domain: ${domainName}`);
    const domain = this.domainLookupByName(domainName);
    const xml = this.libvirt.virDomainGetXMLDesc(domain, 0);
    
    if (!xml) {
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xml, 'text/xml');

    // Get the <graphics> elements
    const graphicsElements = xmlDoc.getElementsByTagName('graphics');

    // Iterate over the <graphics> elements
    for (let i = 0; i < graphicsElements.length; i++) {
      const graphicsElement = graphicsElements[i];

      // Check if the type attribute is 'vnc'
      if (graphicsElement.getAttribute('type') === 'vnc') {
        // Get the port attribute and parse it as an integer
        const port = parseInt(graphicsElement.getAttribute('port') || '-1', 10);
        this.debug.log(`Found VNC port: ${port}`);
        return port;
      }
    }

    return -1;
  }

  // Add more methods to wrap Libvirt functions
}