import {
    Connection,
    Machine as VirtualMachine,
    Error as LibvirtError
} from 'libvirt-node';
import {DOMParser, XMLSerializer} from 'xmldom';

import {Debugger} from '@utils/debug';

/**
 * VncPortService
 *
 * This service class is responsible for retrieving the VNC port for a given domain
 * in a libvirt environment. It encapsulates all the necessary operations to fetch
 * and parse the domain information to extract the VNC port.
 *
 * How it works:
 * 1. The service opens a new libvirt connection.
 * 2. When getVncPort is called with a domain name:
 *    a. It validates the libvirt connection.
 *    b. It looks up the domain by name.
 *    c. It retrieves the XML description of the domain.
 *    d. It parses the XML to find the VNC port.
 *    e. If found, it returns the port number; otherwise, it returns -1.
 *
 * Key methods:
 * - getVncPort(domainName: string): Promise<number>
 *   The main method to retrieve the VNC port for a given domain name.
 *
 * Dependencies:
 * - libvirt connection: Used to interact with the libvirt API.
 * - Debug: Used for logging operations and errors.
 * - DOMParser: Used to parse the XML description of the domain.
 *
 * Error Handling:
 * - Throws LibvirtError with appropriate error codes for libvirt-related issues.
 * - Logs errors using the provided Debug instance.
 *
 * Usage example:
 * ```
 * const connection = // ... your libvirt connection
 * const debugger = new Debug();
 * const vncPortService = new VncPortService();
 *
 * try {
 *   const port = await vncPortService.getVncPort('my-domain-name');
 *   console.log(`VNC port for domain: ${port}`);
 * } catch (error) {
 *   console.error('Failed to get VNC port:', error);
 * }
 * ```
 *
 * Note: Ensure that the libvirt connection is properly initialized before using this service.
 */
export class VncPortService {
    debug: Debugger = new Debugger('virt-manager');
    connection: Connection | null = null;

    constructor() {
        this.connection = Connection.open('qemu:///system');
        if (!this.connection) {
            let error = LibvirtError.lastError();
            this.debug.log('error', error.message);
            this.debug.log('error', 'Failed to connect to hypervisor');
            throw new Error('Failed to connect to hypervisor');
        }
    }


    /**
     * Retrieves the VNC port for a given domain.
     *
     * @param {string} domainName - The name of the domain.
     * @returns {Promise<number>} - A promise that resolves to the VNC port number.
     * @throws {Error} If the VNC port could not be retrieved.
     */
    async getVncPort(domainName: string): Promise<number> {

        this.debug.log(`Getting VNC port for domain: ${domainName}`);

        this.validateConnection();

        try {
            const domain = await this.getDomain(domainName);
            const xml = await this.getDomainXml(domain);
            return this.extractVncPortFromXml(xml);
        } catch (error) {
            this.handleError('Failed to get VNC port', error);
        }
    }

    private validateConnection(): void {
        if (!this.connection) {
            throw new Error('No connection available');
        }
    }

    private async getDomain(domainName: string): Promise<VirtualMachine> {
        if (this.connection == null) {
            throw new Error('No connection available');
        }
        const domain = VirtualMachine.lookupByName(this.connection, domainName);
        if (domain == null) {
            const error = LibvirtError.lastError();
            this.debug.log('error', error.message);
            throw new Error('Failed to find the domain');
        }
        this.debug.log('Domain obtained');
        return domain;
    }

    private async getDomainXml(domain: VirtualMachine): Promise<string> {
        const xml = domain.getXmlDesc(0);
        if (xml == null) {
            const error = LibvirtError.lastError();
            this.debug.log('error', error.message);
            throw new Error('Failed to get domain XML description');
        }
        this.debug.log('Domain XML description obtained');
        return xml;
    }

    private extractVncPortFromXml(xml: string): number {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xml, 'text/xml');
        const graphicsElements = xmlDoc.getElementsByTagName('graphics');

        if (graphicsElements && graphicsElements.length > 0) {
            for (let i = 0; i < graphicsElements.length; i++) {
                const graphicsElement = graphicsElements[i];
                if (graphicsElement.getAttribute('type') === 'vnc') {
                    const port = parseInt(graphicsElement.getAttribute('port') || '-1', 10);
                    this.debug.log(`Found VNC port: ${port}`);
                    return port;
                }
            }
        }

        this.debug.log('No VNC port found');
        return -1;
    }

    private handleError(message: string, error: unknown): never {
        this.debug.log('error', message);
        this.debug.log(error instanceof Error ? error.message : String(error));
        throw new Error(message);
    }
}