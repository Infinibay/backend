// Mock XML Generator for testing

export class XmlGenerator {
  constructor() {}
  
  generateDomainXML(config: any): string {
    return '<domain type="kvm"><name>test</name></domain>'
  }
  
  generateNetworkXML(config: any): string {
    return '<network><name>test</name></network>'
  }
}

export default XmlGenerator
