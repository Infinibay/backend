import * as ffi from 'ffi-napi';
import ref from 'ref-napi';
// import { refType } from 'ref-napi';
import ArrayType from 'ref-array-napi';
import { DOMParser } from 'xmldom';
import StructType from 'ref-struct-napi';

const voidPtr = ref.refType(ref.types.void);

// https://libvirt.org/html/libvirt-libvirt-domain.html#virDomainInfoPtr
const VirDomainInfo = StructType({
  state: 'uchar',        // unsigned char
  maxMem: 'ulong',       // unsigned long
  memory: 'ulong',       // unsigned long
  nrVirtCpu: 'ushort',   // unsigned short
  cpuTime: 'ulonglong'   // unsigned long long
});

const virDomainInfoPtr = ref.refType(VirDomainInfo);

export interface VirDomainInfo {
  state: number;
  maxMem: number;
  memory: number;
  nrVirtCpu: number;
  cpuTime: number;
}

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

  constructor() {
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
      'virConnectListAllDomains': ['int', ['pointer', voidPtr, 'int']],
      'virDomainGetInfo': ['int', ['pointer', virDomainInfoPtr]],
      'virDomainGetName': ['string', ['pointer']],
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
    this.connection = this.libvirt.virConnectOpen(uri);
  
    if (this.connection && this.connection.isNull()) {
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
    return this.connection !== null && !this.connection.isNull();
  }

  /**
   * This method closes the connection to the hypervisor.
   * 
   * @throws {LibvirtError} - Throws an error if the operation fails.
   */
  public close(): void {
    if (this.connection) {
      const result = this.libvirt.virConnectClose(this.connection);

      if (result < 0) {
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
    const domain = this.libvirt.virDomainLookupByName(this.connection, name);

    if (domain.isNull()) {
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
    const domainBuffer = this.libvirt.virDomainLookupByName(this.connection, domain);
    const result = this.libvirt.virDomainCreate(domainBuffer);

    if (result < 0) {
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
    const domainBuffer = this.libvirt.virDomainLookupByName(this.connection, domain);
    const result = this.libvirt.virDomainDestroy(domainBuffer);

    if (result < 0) {
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
  public domainDefineXML(xml: string,): Buffer {
    const domain = this.libvirt.virDomainDefineXML(this.connection, xml);

    if (domain.isNull()) {
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
    // Lookup the domain by its name
    const domain = this.domainLookupByName(name);

    // Undefine the old domain
    const undefineResult = this.libvirt.virDomainUndefine(domain);
    if (undefineResult < 0) {
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_INTERNAL_ERROR);
    }

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
    const domain = this.domainLookupByName(name);
    const state = this.libvirt.virDomainGetState(domain);

    let result;
    if (state === VirDomainState.VIR_DOMAIN_PAUSED) {
      result = this.libvirt.virDomainResume(domain);
    } else {
      result = this.libvirt.virDomainCreate(domain);
    }

    if (result < 0) {
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
    const domain = this.domainLookupByName(name);
    const result = this.libvirt.virDomainDestroy(domain);
  
    if (result < 0) {
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
    const domain = this.domainLookupByName(name);
    const result = this.libvirt.virDomainSuspend(domain);
  
    if (result < 0) {
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
    const domain = this.domainLookupByName(name);
    const state = this.libvirt.virDomainGetState(domain);

    if (state < 0) {
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }

    switch (state) {
      case 1:
        return 'Running';
      case 2:
        return 'Blocked';
      case 3:
        return 'Paused';
      case 4:
        return 'Shutdown';
      case 5:
        return 'Shutoff';
      case 6:
        return 'Crashed';
      case 7:
        return 'PMSuspended';
      default:
        return 'Unknown';
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
  public createDisk(poolName: string, xml: string): Buffer {
    // Lookup the storage pool by its name
    const pool = this.libvirt.virStoragePoolLookupByName(this.connection, poolName);

    // Create the storage volume
    const volume = this.libvirt.virStorageVolCreateXML(pool, xml, 0);

    if (volume.isNull()) {
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }

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
    // Define the storage pool
    const pool = this.libvirt.virStoragePoolDefineXML(this.connection, xml, 0);

    if (pool.isNull()) {
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }

    // Create (start) the storage pool
    const result = this.libvirt.virStoragePoolCreate(pool, 0);

    if (result < 0) {
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }

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
    // Define the network
    const network = this.libvirt.virNetworkDefineXML(this.connection, xml);
  
    if (network.isNull()) {
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
  
    // Create (start) the network
    const result = this.libvirt.virNetworkCreate(network);
  
    if (result < 0) {
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
  
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
    const domain = this.domainLookupByName(domainName);
    const network = this.libvirt.virNetworkLookupByName(this.connection, networkName);
  
    if (network.isNull()) {
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_NETWORK);
    }
  
    const result = this.libvirt.virDomainAttachDevice(domain, `<interface type='network'><source network='${networkName}'/></interface>`);
  
    if (result < 0) {
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
    const domain = this.domainLookupByName(domainName);
    const network = this.libvirt.virNetworkLookupByName(this.connection, networkName);
  
    if (network.isNull()) {
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_NO_NETWORK);
    }
  
    const result = this.libvirt.virDomainDetachDevice(domain, `<interface type='network'><source network='${networkName}'/></interface>`);
  
    if (result < 0) {
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
    const domain = this.domainLookupByName(domainName);
    const xml = this.libvirt.virDomainGetXMLDesc(domain, 0);
    const xmlDoc = new DOMParser().parseFromString(xml, 'text/xml');
    const interfaces = xmlDoc.getElementsByTagName('interface');

    const networks = Array.from(interfaces)
        .map((iface: any) => iface.getElementsByTagName('source')[0])
        .filter((source: Element | null) => source && source.getAttribute('network'))
        .map((source: Element) => source.getAttribute('network') as string);

    return networks;
  }

  async domainSetBootloader(domainName: string, isoPath: string): Promise<void> {
    // Fetch the domain's XML definition
    const xml = this.libvirt.virDomainGetXMLDesc(domainName, 0);
  
    // Parse the XML
    let xmlDoc = new DOMParser().parseFromString(xml, 'text/xml');
  
    // Find the <os> element
    let osElement = xmlDoc.getElementsByTagName('os')[0];
  
    // Create a new <boot> element
    const bootElement = xmlDoc.createElement('boot');
    bootElement.setAttribute('dev', 'cdrom');
    bootElement.setAttribute('order', '1');  // Boot order 1 is the first device to try. It does not start on 0
  
    // Append the <boot> element to the <os> element
    osElement.appendChild(bootElement);
  
    // Serialize the modified XML
    const newXml = new XMLSerializer().serializeToString(xmlDoc);
  
    // Redefine the domain with the modified XML
    this.libvirt.virDomainDefineXML(newXml);
  
    // Set the ISO path for the domain's CDROM device
    // This method overwrite ONLY the given devices, in this case, the cdroom
    this.libvirt.virDomainUpdateDeviceFlags(domainName, `<disk type='file' device='cdrom'><driver name='qemu' type='raw'/><source file='${isoPath}'/><target dev='hdc' bus='ide'/><readonly/></disk>`, virDomainModificationImpact.VIR_DOMAIN_AFFECT_CONFIG);

    // Reload the xml
    xmlDoc = new DOMParser().parseFromString(xml, 'text/xml');
  }

  public listAllDomains(): string[] {
    const connection = this.libvirt.virConnectOpen('qemu:///system');
    if (connection.isNull()) {
        throw new Error('Failed to open connection');
    }

    const voidPtr = ref.refType(ref.types.void);
    const domainsPtrPtr = ref.alloc(voidPtr);
    const flags = 0; // 0 for listing both active and inactive domains
    const numDomains = this.libvirt.virConnectListAllDomains(connection, domainsPtrPtr, flags);

    if (numDomains < 0) {
        this.libvirt.virConnectClose(connection);
        throw new Error('Failed to list all domains');
    }

    const domainNames: string[] = [];
    const buffer = domainsPtrPtr.deref();
    const sizeOfPointer = ref.types.void.size;

    for (let i = 0; i < numDomains; i++) {
        const domainPtr = ref.get(domainsPtrPtr, i * sizeOfPointer, voidPtr);

        // Use virDomainGetName to get the domain name
        const domainName = this.libvirt.virDomainGetName(domainPtr);
        if (domainName) {
            domainNames.push(domainName);
        }
    }

    // Clean up and close the connection
    this.libvirt.virConnectClose(connection);

    return domainNames;
}

  lookupDomainByName(name: string): string {
    return this.libvirt.virDomainLookupByName(this.connection, name).toString();
  }

  domainGetInfo(name: string): VirDomainInfo {
    const domain = this.domainLookupByName(name);
    const info = new VirDomainInfo();
    const result = this.libvirt.virDomainGetInfo(domain, info.ref());
  
    if (result < 0) {
      throw new LibvirtError(LibvirtErrorCodes.VIR_ERR_OPERATION_FAILED);
    }
  
    // Convert the returned struct to a JavaScript object
    const infoObject: VirDomainInfo = {
      state: info.state,
      maxMem: info.maxMem,
      memory: info.memory,
      nrVirtCpu: info.nrVirtCpu,
      cpuTime: info.cpuTime,
    };
  
    return infoObject;
  }

  // Add more methods to wrap Libvirt functions
}