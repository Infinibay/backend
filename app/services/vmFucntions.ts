// import { spawn } from "child_process";
// import xml2js from "xml2js";
// import fs from "fs";
// import GenerateXML from "./generateXML";

// interface ExecResult {
//   stdout: string;
//   stderr: string;
// }

// class VM {
//   async createVM(name: any, ram: any, cpu: any, storage: any, os: any, iso: any) {
//     const xml = new GenerateXML(name);
//     xml.setRAM(ram);
//     xml.setCPUs(cpu);
//     xml.setStorage(storage);
//     xml.setOS(os);
//     xml.setIso(iso);

//     try {
//       await xml.generate();
//       xml.setGraphics();
//       xml.setDrivers();

//       const builder = new xml2js.Builder();
//       const newXmlString = builder.buildObject(xml.json);
//       fs.writeFileSync("default.xml", newXmlString);

//       const { stdout, stderr } = await this.exec("virsh define default.xml");

//       if (stderr) {
//         throw new Error(stderr);
//       }

//       return { status: true };
//     } catch (error) {
//       throw error;
//     }
//   }

//   async startVM(name: string) {
//     try {
//       const comm = `virsh start ${name}`;
//       await this.exec(comm);
//       return true;
//     } catch (error) {
//       return false;
//     }
//   }

//   async stopVM(name: string) {
//     try {
//       const comm = `virsh destroy ${name}`;
//       await this.exec(comm);
//       return true;
//     } catch (error) {
//       return false;
//     }
//   }

//   async deleteVM(name: string) {
//     try {
//       const comm = `virsh undefine --nvram ${name}`;
//       await this.exec(comm);
//       return true;
//     } catch (error) {
//       return false;
//     }
//   }

//   async updateVM(name: string, newname: string, ram: number, cpu: number) {
//     try {
//       const comm = `virsh destroy ${name} && virsh domrename ${name} ${newname} && virsh setmaxmem ${newname} ${ram} --config && virsh setmem ${newname} ${ram} --config && virsh setvcpus ${newname} ${cpu} --config`;
//       await this.exec(comm);
//       return true;
//     } catch (error) {
//       return false;
//     }
//   }

//   async exec(command: string): Promise<ExecResult> {
//     return new Promise((resolve, reject) => {
//       const process = spawn("bash", ["-c", command]);
//       let stdout = "";
//       let stderr = "";

//       process.stdout.on("data", (data) => {
//         stdout += data.toString();
//       });

//       process.stderr.on("data", (data) => {
//         stderr += data.toString();
//       });

//       process.on("close", (code) => {
//         if (code === 0) {
//           resolve({ stdout, stderr });
//         } else {
//           reject(new Error(`Command execution failed with code ${code}`));
//         }
//       });
//     });
//   }
// }

// export default VM;
