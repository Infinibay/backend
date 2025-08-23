// Type extensions for @infinibay/libvirt-node
// This file helps TypeScript recognize the snapshot methods that were recently added

declare module '@infinibay/libvirt-node' {
  export interface Machine {
    snapshotCreateXml(xml: string, flags: number): Snapshot | null;
    listAllSnapshots(flags: number): Snapshot[] | null;
    snapshotLookupByName(name: string, flags: number): Snapshot | null;
    revertToSnapshot(snapshot: Snapshot, flags: number): boolean;
    snapshotCurrent(flags: number): Snapshot | null;
    hasCurrentSnapshot(flags: number): boolean | null;
    numOfSnapshots(flags: number): number | null;
  }

  export interface Snapshot {
    getName(): string | null;
    getXmlDesc(flags: number): string | null;
    delete(flags: number): boolean;
    isCurrent(flags: number): boolean | null;
    hasMetadata(flags: number): boolean | null;
    getParent(flags: number): Snapshot | null;
    free(): boolean;
  }
}

export {};