import { spawn } from "child_process";
import xml2js from "xml2js";
import fs from "fs";

class generateXML {
  constructor(name) {
    this.json = { name: name, memory: 0, cpu: 0, storage: 0, os: "", iso: "", tpm: 0 };
    this.xml = "";
  }

  setRAM(size) {
    this.json["memory"] = size;
  }

  setStorage(size) {
    this.json["storage"] = size;
  }

  setCPUs(count) {
    this.json["cpu"] = count;
  }

  setOS(os) {
    this.json["os"] = os;
  }

  setIso(iso) {
    this.json["iso"] = iso;
  }

  setTpm(bit) {
    this.json["tpm"] = bit;
  }

  setGraphics() {
    let port = JSON.parse(fs.readFileSync("port.json")).avaialbePort;
    console.log(JSON.parse(port));
    fs.writeFileSync("port.json", JSON.stringify({ avaialbePort: port + 1 }));
    this.json.domain.devices[0].graphics[0]["$"] = { type: "spice", port: port, autoport: "no", listen: "0.0.0.0" };
    this.json.domain.devices[0].graphics[0]["listen"] = [{ $: { type: "address", listen: "0.0.0.0" } }];
  }

  setDrviers() {
    this.json.domain.devices[0].disk.push({
      $: {
        type: "file",
        device: "cdrom",
      },
      driver: [
        {
          $: {
            name: "qemu",
            type: "raw",
          },
        },
      ],
      source: [
        {
          $: {
            file: "/var/lib/libvirt/driver/virtio-win-0.1.229.iso",
          },
        },
      ],
      target: [
        {
          $: {
            dev: "hdc",
            bus: "sata",
          },
        },
      ],
      readonly: [{}],
      address: [
        {
          $: {
            type: "drive",
            controller: "0",
            bus: "0",
            target: "0",
            unit: "2",
          },
        },
      ],
    });
  }

  async generate() {
    let comm = "";
    if (this.json.os == "linux") {
      comm = `export VIRTINSTALL_OSINFO_DISABLE_REQUIRE=1 && virt-install --name ${this.json.name} --ram ${this.json.memory} --vcpus ${this.json.cpu} \
            --disk path=/var/lib/libvirt/images/${this.json.name}.qcow2,size=${this.json.storage} --os-type ${this.json.os} --console pty,target_type=serial \
             --cdrom /var/lib/libvirt/iso/${this.json.iso} --print-xml`;
    } else {
      if (this.json.tpm == 1) {
        comm = `export VIRTINSTALL_OSINFO_DISABLE_REQUIRE=1 && virt-install --name ${this.json.name} --ram ${this.json.memory} --vcpus=${this.json.cpu} \
                --disk path=/var/lib/libvirt/images/${this.json.name}.img,bus=virtio,size=${this.json.storage},format=qcow2 --network=network=default,model=virtio,mac=RANDOM --graphics spice,listen=0.0.0.0 --cdrom=/var/lib/libvirt/iso/${this.json.iso} --os-type=${this.json.os} \
                --boot uefi,loader=/usr/share/ovmf/OVMF.fd,  --print-xml`;
      } else {
        comm = `export VIRTINSTALL_OSINFO_DISABLE_REQUIRE=1 && virt-install --name ${this.json.name} --ram ${this.json.memory} --vcpus=${this.json.cpu} \
                --disk path=/var/lib/libvirt/images/${this.json.name}.img,bus=virtio,size=${this.json.storage},format=qcow2 --network=network=default,model=virtio,mac=RANDOM --graphics spice,listen=0.0.0.0 --cdrom=/var/lib/libvirt/iso/${this.json.iso} --os-type=windows --print-xml`;
      }
    }

    try {
      console.log(comm);
      const process = spawn("bash", ["-c", comm]);
      const stdoutChunks = [];
      const stderrChunks = [];

      process.stdout.on("data", (data) => {
        stdoutChunks.push(data);
      });

      process.stderr.on("data", (data) => {
        stderrChunks.push(data);
      });

      await new Promise((resolve) => {
        process.on("close", resolve);
      });

      const stdout = Buffer.concat(stdoutChunks).toString();
      const stderr = Buffer.concat(stderrChunks).toString();

      if (stderr) {
        console.error(`Command STDERR: ${stderr}`);
        return false;
      }

      console.log(this.json);
      let xml = '<domain type="kvm">' + stdout.split('<domain type="kvm">')[1];
      xml = xml.replace("<on_reboot>destroy</on_reboot>", "<on_reboot>restart</on_reboot>");
      xml2js.parseString(xml, (err, result) => {
        this.json = result;
      });
      return true;
    } catch (error) {
      console.error(`Error: ${error.message}`);
      return;
    }
  }
}

export default generateXML;
