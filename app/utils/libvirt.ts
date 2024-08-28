import { Connection, Machine as VirtualMachine, StoragePool, StorageVol, Network } from 'libvirt-node';
import { DOMParser, XMLSerializer } from 'xmldom';
import { parseStringPromise } from 'xml2js';

import { Debugger } from './debug';

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
  private connection: Connection | null = null;
  private debug: Debugger = new Debugger('libvirt');

  constructor() {
    this.debug.log('Opening libvirt.so');
    // Load the Libvirt library
  }

  /**
   * This method establishes a connection to the hypervisor.
   * 
   * @param {string} uri - The URI of the hypervisor to connect to.
   * @returns {Buffer | null} - A buffer representing the connection, or null if the connection fails.
   * @throws {LibvirtError} - Throws an error if the connection fails.
   */
  public connect(uri: string): Connection | null {
    this.debug.log('Connecting to hypervisor');
    try {
      this.connection = Connection.open(uri);
    } catch (error) {
      this.debug.log('error', 'Failed to connect to hypervisor');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
    }

    if (this.connection && !this.connection.isAlive()) {
      this.debug.log('error', 'Failed to connect to hypervisor');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
    }

    return this.connection;
  }

  /**
   * This method checks if there is an active connection to the hypervisor.
   * 
   * @returns {boolean} - Returns true if there is an active connection, false otherwise.
   */
  public isConnected(): boolean {
    return this.connection !== null && this.connection.isAlive();
  }

  /**
   * This method closes the connection to the hypervisor.
   * 
   * @throws {LibvirtError} - Throws an error if the operation fails.
   */
  public close(): void {
    this.debug.log('Closing connection to hypervisor');
    if (this.connection) {
      try {
        const result = this.connection.close();
        this.debug.log('Closed connection to hypervisor');

        this.connection = null;
      } catch (error) {
        this.debug.log('error', 'Failed to close connection to hypervisor');
        throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_INTERNAL_ERROR);
      }
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
   * @returns {VirtualMachine} - A buffer representing the domain.
   * @throws {LibvirtError} - Throws an error if the domain does not exist.
   */
  public domainLookupByName(name: string): VirtualMachine {
    this.debug.log('Looking up domain by name', name);
    if (!this.connection) {
      this.debug.log('error', 'Failed to find the domain');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
    }
    try {
      const domain = VirtualMachine.lookupByName(this.connection, name);

      return domain;
    } catch (error) {
      this.debug.log('error', 'Failed to find the domain');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_DOMAIN);
    }
  }

  /**
   * This method creates (starts) a domain.
   * 
   * @param {Buffer} domain - A buffer representing the domain to be created.
   * @returns {number} - Returns 0 on success, -1 in case of error.
   * @throws {LibvirtError} - Throws an error if the operation fails.
   */
  public domainCreate(domain: string): void {
    this.debug.log('Starting VM', domain);
    try {
      const virtualMachine = this.domainLookupByName(domain);
      this.debug.log('VM Obtained');
      const result = virtualMachine.create();
      this.debug.log('VM Started');

      return;
    } catch (error) {
      this.debug.log('error', 'Failed to start VM');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
  }

  /**
   * This method destroys a domain.
   * 
   * @param {Buffer} domain - A buffer representing the domain to be destroyed.
   * @returns {number} - Returns 0 on success, -1 in case of error.
   * @throws {LibvirtError} - Throws an error if the operation fails.
   */
  public domainDestroy(domain: string): void {
    this.debug.log('Destroying VM', domain);
    try {
      const virtualMachine = this.domainLookupByName(domain);
      this.debug.log('VM Obtained');
      virtualMachine.destroy();
      this.debug.log('VM Destroyed');

      return;
    } catch (error) {
      this.debug.log('error', 'Failed to destroy VM');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
  }

  /**
   * This method undefines a domain, effectively deleting it.
   * 
   * @param {string} domain - The name of the domain to be undefined.
   * @returns {number} - Returns 0 on success, -1 in case of error.
   * @throws {LibvirtError} - Throws an error if the operation fails.
   */
  public domainUndefine(domain: string): void {
    this.debug.log('Undefining VM', domain);
    try {
      const virtualMachine = this.domainLookupByName(domain);
      this.debug.log('VM Obtained');
      virtualMachine.undefine();
      this.debug.log('VM Undefined');
      return;
    } catch (error) {
      this.debug.log('error', 'Failed to undefine VM');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
  }

  /**
   * This method defines a domain from an XML string.
   * 
   * @param {string} xml - The XML string defining the domain.
   * @returns {Buffer} - A buffer representing the defined domain.
   * @throws {LibvirtError} - Throws an error if the domain definition is invalid.
   */
  public domainDefineXML(xml: string): VirtualMachine {
    this.debug.log('Defining domain from XML', xml);
    try {
      if (!this.connection) {
        this.debug.log('error', 'Failed to define domain from XML');
        throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
      }
      const machine = VirtualMachine.defineXml(this.connection, xml);
      this.debug.log('Domain defined successfully');
      return machine;
    } catch (error) {
      this.debug.log('error', 'Failed to define domain from XML', error instanceof Error ? error.message : String(error));
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_INVALID_ARG);
    }
  }

  /**
   * This method updates a domain with a new XML configuration.
   * 
   * @param {string} name - The name of the domain to be updated.
   * @param {string} newXml - The new XML configuration for the domain.
   * @returns {Buffer} - A buffer representing the updated domain.
   * @throws {LibvirtError} - Throws an error if the domain does not exist, if the new XML configuration is invalid, or if the operation fails.
   */
  public updateDomain(name: string, newXml: string): VirtualMachine {
    this.debug.log('Updating domain', name, newXml);
    if (!this.connection) {
      this.debug.log('error', 'Failed to update domain');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
    }

    // Lookup the domain by its name
    const domain = VirtualMachine.lookupByName(this.connection, name);

    this.debug.log('Undefining the old domain');
    // Undefine the old domain
    domain.undefine();

    this.debug.log('Defining a new domain with the updated XML');
    // Define a new domain with the updated XML
    const newDomain = VirtualMachine.defineXml(this.connection, newXml);
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

    if (!this.connection) {
      this.debug.log('error', 'No connection available');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
    }

    try {
      const domain = VirtualMachine.lookupByName(this.connection, name);
      const info = domain.getInfo();
      
      this.debug.log('Domain state', info.state);
      
      if (info.state === 3) { // VIR_DOMAIN_PAUSED
        this.debug.log('Domain is paused, resuming');
        domain.resume();
      } else if (info.state === 5) { // VIR_DOMAIN_SHUTOFF
        this.debug.log('Domain is shutoff, creating');
        domain.create();
      } else {
        this.debug.log('Domain is already running or in an unexpected state');
      }

      this.debug.log('Domain powered on successfully');
    } catch (error) {
      this.debug.log('error', 'Failed to power on domain', error instanceof Error ? error.message : String(error));
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
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

    if (!this.connection) {
      this.debug.log('error', 'No connection available');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
    }

    try {
      const domain = VirtualMachine.lookupByName(this.connection, name);
      this.debug.log('Domain obtained');
      
      domain.destroy();
      
      this.debug.log('Domain powered off successfully');
    } catch (error) {
      this.debug.log('error', 'Failed to power off domain', error instanceof Error ? error.message : String(error));
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
  }

  /**
   * This method suspends a domain.
   * 
   * @param {string} name - The name of the domain to be suspended.
   * @throws {LibvirtError} - Throws an error if the operation fails.
   */
  public suspend(name: string): void {
    this.debug.log('Suspending domain', name);

    if (!this.connection) {
      this.debug.log('error', 'No connection available');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
    }

    try {
      const domain = VirtualMachine.lookupByName(this.connection, name);
      this.debug.log('Domain obtained');
      
      domain.suspend();
      
      this.debug.log('Domain suspended successfully');
    } catch (error) {
      this.debug.log('error', 'Failed to suspend domain', error instanceof Error ? error.message : String(error));
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
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

    if (!this.connection) {
      this.debug.log('error', 'No connection available');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
    }

    try {
      const domain = VirtualMachine.lookupByName(this.connection, name);
      this.debug.log('Domain obtained');

      const info = domain.getInfo();
      let status: string;

      switch (info.state) {
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
    } catch (error) {
      this.debug.log('error', 'Failed to get domain status', error instanceof Error ? error.message : String(error));
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
  }

  /**
   * This method creates a disk in a specified storage pool from an XML string.
   * 
   * @param {string} poolName - The name of the storage pool where the disk will be created.
   * @param {string} xml - The XML string defining the disk.
   * @returns {Buffer} - A buffer representing the created disk.
   * @throws {LibvirtError} - Throws an error if the disk definition is invalid or if the operation fails.
   */
  public createDisk(poolName: string, xml: string): StorageVol {
    this.debug.log('Creating disk in pool', poolName, 'with XML');
    
    try {
      if (!this.connection) {
        this.debug.log('error', 'No connection available');
        throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
      }

      // Lookup the storage pool by its name
      const pool = StoragePool.lookupByName(this.connection, poolName);
      this.debug.log('Storage pool obtained');

      // Create the storage volume
      const volume = StorageVol.createXml(pool, xml, 0);
      this.debug.log('Storage volume created');

      this.debug.log('Disk created successfully');
      return volume;
    } catch (error) {
      this.debug.log('error', 'Failed to create storage volume', error instanceof Error ? error.message : String(error));
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
  }

  /**
   * This method creates a storage pool from an XML string.
   * 
   * @param {string} xml - The XML string defining the storage pool.
   * @returns {Buffer} - A buffer representing the created storage pool.
   * @throws {LibvirtError} - Throws an error if the storage pool definition is invalid or if the operation fails.
   */
  public createStoragePool(xml: string): StoragePool {
    this.debug.log('Defining storage pool from XML', xml);

    try {
      if (!this.connection) {
        this.debug.log('error', 'No connection available');
        throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
      }

      // Define and create the storage pool
      const pool = StoragePool.createXml(this.connection, xml, 0);
      this.debug.log('Storage pool defined and created successfully');

      return pool;
    } catch (error) {
      this.debug.log('error', 'Failed to create storage pool', error instanceof Error ? error.message : String(error));
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
  }

  /**
   * This method creates a network from an XML string.
   * 
   * @param {string} xml - The XML string defining the network.
   * @returns {Buffer} - A buffer representing the created network.
   * @throws {LibvirtError} - Throws an error if the network definition is invalid or if the operation fails.
   */
  public createNetwork(xml: string): Network {
    this.debug.log('Defining network from XML', xml);

    try {
      if (!this.connection) {
        this.debug.log('error', 'No connection available');
        throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
      }

      // Define the network
      const network = Network.createXml(this.connection, xml);
      this.debug.log('Network defined successfully');

      // Create (start) the network
      this.debug.log('Creating network');
      network.create();
      this.debug.log('Network created successfully');

      return network;
    } catch (error) {
      this.debug.log('error', 'Failed to create network', error instanceof Error ? error.message : String(error));
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
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

    try {
      if (!this.connection) {
        this.debug.log('error', 'No connection available');
        throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
      }

      const domain = VirtualMachine.lookupByName(this.connection, domainName);
      this.debug.log('Domain obtained');

      // Verify that the network exists before proceeding
      // This check is important for:
      // 1. Validating the network's existence
      // 2. Ensuring consistency in error handling
      // 3. Potential future use if additional network operations are needed
      // 4. Early error detection for debugging purposes
      const network = Network.lookupByName(this.connection, networkName);
      this.debug.log('Network obtained');

      const interfaceXml = `<interface type='network'><source network='${networkName}'/></interface>`;
      domain.attachDevice(interfaceXml, 0);
      this.debug.log('Domain attached to network successfully');
    } catch (error) {
      this.debug.log('error', 'Failed to add domain to network', error instanceof Error ? error.message : String(error));
      if (error instanceof Error && error.message.includes('no network')) {
        throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_NETWORK);
      }
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
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

    try {
      if (!this.connection) {
        this.debug.log('error', 'No connection available');
        throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
      }

      const domain = VirtualMachine.lookupByName(this.connection, domainName);
      this.debug.log('Domain obtained');

      // Verify that the network exists before proceeding
      const network = Network.lookupByName(this.connection, networkName);
      this.debug.log('Network obtained');

      const interfaceXml = `<interface type='network'><source network='${networkName}'/></interface>`;
      domain.detachDevice(interfaceXml, 0);
      this.debug.log('Domain detached from network successfully');
    } catch (error) {
      this.debug.log('error', 'Failed to remove domain from network', error instanceof Error ? error.message : String(error));
      if (error instanceof Error && error.message.includes('no network')) {
        throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_NETWORK);
      }
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
  }

  /**
   * This method retrieves the networks associated with a given domain.
   * 
   * @param {string} domainName - The name of the domain.
   * @returns {string[]} - An array of network names associated with the domain.
   */
  public getDomainNetworks(domainName: string): string[] {
    this.debug.log('Getting domain networks', domainName);
    
    if (!this.connection) {
      this.debug.log('error', 'No connection available');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
    }

    try {
      const domain = VirtualMachine.lookupByName(this.connection, domainName);
      this.debug.log('Domain obtained');

      const xml = domain.getXmlDesc(0);
      this.debug.log('Domain XML description obtained');

      // Parse the XML string
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xml, 'text/xml');
      this.debug.log('XML document parsed');

      const interfaces = xmlDoc.getElementsByTagName('interface');
      this.debug.log('Interfaces obtained');

      const networks = Array.from(interfaces)
        .map(iface => iface.getElementsByTagName('source')[0])
        .filter(source => source && source.getAttribute('network'))
        .map(source => source.getAttribute('network') as string);
      
      this.debug.log('Networks obtained', networks.join(', '));

      return networks;
    } catch (error) {
      this.debug.log('error', 'Failed to get domain networks', error instanceof Error ? error.message : String(error));
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
  }

  async domainSetBootloader(domainName: string, isoPath: string): Promise<void> {
    this.debug.log('Setting bootloader for domain', domainName, 'with ISO path', isoPath);

    if (!this.connection) {
      this.debug.log('error', 'No connection available');
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
    }

    try {
      // Lookup the domain
      const domain = VirtualMachine.lookupByName(this.connection, domainName);
      this.debug.log('Domain obtained');

      // Get the XML description
      const xml = domain.getXmlDesc(0);
      this.debug.log('Domain XML description obtained');

      // Parse the XML string
      const parser = new DOMParser();
      let xmlDoc = parser.parseFromString(xml, 'text/xml');

      // Find the <os> element
      let osElement = xmlDoc.getElementsByTagName('os')[0];

      // Create a new <boot> element
      const bootElement = xmlDoc.createElement('boot');
      bootElement.setAttribute('dev', 'cdrom');

      // Append the <boot> element to the <os> element
      if (osElement.hasChildNodes()) {
        osElement.insertBefore(bootElement, osElement.firstChild);
      } else {
        osElement.appendChild(bootElement);
      }

      // Serialize the modified XML
      const newXml = new XMLSerializer().serializeToString(xmlDoc);
      this.debug.log('Modified XML serialized');

      // Redefine the domain with the modified XML
      VirtualMachine.defineXml(this.connection, newXml);
      this.debug.log('Domain redefined with modified XML');

      const diskXml = `<disk type='file' device='disk'>
        <driver name='qemu' type='raw'/>
        <source file='${isoPath}'/>
        <target dev='hda' bus='ide'/>
        <address type='drive' controller='0' bus='0' target='0' unit='0'/>
      </disk>`;

      // Update the domain's device
      domain.updateDevice(diskXml, 1);  // 1 corresponds to VIR_DOMAIN_AFFECT_CONFIG, persistent
      this.debug.log('ISO path set for domain\'s CDROM device');

    } catch (error) {
      this.debug.log('error', 'Failed to set bootloader for domain', error instanceof Error ? error.message : String(error));
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
  }

  public listAllDomains(): string[] {
    if (!this.connection) {
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
    }

    try {
      const domains = this.connection.listAllDomains(0); // 0 means no flags, list all domains
      return domains.map(domain => {
        const name = domain.getName();
        return name;
      });
    } catch (error) {
      this.debug.log('error', 'Failed to list all domains', error instanceof Error ? error.message : String(error));
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
  }

  lookupDomainByName(name: string): string {
    if (!this.connection) {
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
    }
    try {
      const domain = VirtualMachine.lookupByName(this.connection, name);
      return domain.getName();
    } catch (error) {
      this.debug.log('error', 'Failed to lookup domain by name', error instanceof Error ? error.message : String(error));
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_DOMAIN);
    }
  }

  domainGetInfo(name: string): any {
    if (!this.connection) {
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
    }
    try {
      const domain = VirtualMachine.lookupByName(this.connection, name);
      const info = domain.getInfo();

      return {
        state: info.state,
        maxMem: info.maxMem,
        memory: info.memory,
        nrVirtCpu: info.nrVirtCpu,
        cpuTime: info.cpuTime
      };
    } catch (error) {
      this.debug.log('error', 'Failed to get domain info', error instanceof Error ? error.message : String(error));
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
  }

  async createStorage(size: number, fileName: string): Promise<void> {
    if (!this.connection) {
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
    }

    try {
      // Assuming we have a default storage pool, if not, you might need to create or specify one
      const storagePool = StoragePool.lookupByName(this.connection, 'default');
      
      const volumeXml = `
        <volume>
          <name>${fileName}</name>
          <allocation>0</allocation>
          <capacity unit="G">${size}</capacity>
          <target>
            <format type="qcow2"/>
          </target>
        </volume>
      `;

      const volume = StorageVol.createXml(storagePool, volumeXml, 0);
      
      if (!volume) {
        throw new Error('Failed to create storage volume');
      }

      this.debug.log('Storage volume created successfully');
    } catch (error) {
      this.debug.log('error', 'Failed to create storage', error instanceof Error ? error.message : String(error));
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
  }

  async getVncPort(domainName: string): Promise<number> {
    this.debug.log(`Getting VNC port for domain: ${domainName}`);
    if (!this.connection) {
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_CONNECT);
    }

    try {
      const domain = VirtualMachine.lookupByName(this.connection, domainName);
      this.debug.log('Domain obtained');

      const xml = domain.getXMLDesc(0);
      this.debug.log('Domain XML description obtained');

      // Parse the XML string
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xml, 'text/xml');

      // Get the <graphics> elements
      const graphicsElements = xmlDoc.getElementsByTagName('graphics');

      // Iterate over the <graphics> elements
      for (const graphicsElement of graphicsElements) {
        if (graphicsElement.getAttribute('type') === 'vnc') {
          const port = parseInt(graphicsElement.getAttribute('port') || '-1', 10);
          this.debug.log(`Found VNC port: ${port}`);
          return port;
        }
      }

      this.debug.log('No VNC port found');
      return -1;
    } catch (error) {
      this.debug.log('error', 'Failed to get VNC port', error instanceof Error ? error.message : String(error));
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
  }

  // Add more methods to wrap Libvirt functions
}