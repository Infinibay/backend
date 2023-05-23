import GenerateXML from './generateXML';
class VM {
    createVM(name, ram, cpu, storage, os, iso) {
        return new Promise((resolve, reject) => {
            const xml = new GenerateXML(name);
            xml.setRAM(ram);
            xml.setCPUs(cpu);
            xml.setStorage(storage);
            xml.setOS(os);
            xml.setIso(iso);
            xml.generate().then(async () => {
                xml.setGraphics();
                xml.setDrviers();
                const builder = new xml2js.Builder();
                const newXmlString = builder.buildObject(xml.json);
                fs.writeFileSync('default.xml', newXmlString);
                const { stdout, stderr } = await exec("virsh define default.xml");
                    if(stderr){
                        reject(stderr)
                    }
                    else{
                        resolve({"status":true})
                    }
            }).catch((error) => {
                reject(error)
            });    
        })
    }

    startVM(name){
        return new Promise((resolve, reject) => {
            const comm = `virsh start ${name}`
            exec(comm).then((data)=>{
                resolve(true)
            }).catch((err)=>{
                reject(false)
            })
        })
    }

    stopVM(name){
        return new Promise((resolve, reject) => {
            const comm = `virsh destroy ${name}`
            exec(comm).then((data)=>{
                resolve(true)
            }).catch((err)=>{
                reject(false)
            })
        })
    }



    deleteVM(name){
        return new Promise((resolve, reject) => {
            const comm = `virsh undefine --nvram ${name}`
            exec(comm).then((data)=>{
                resolve(true)
            }).catch((err)=>{
                reject(false)
            })
        })
    }

    updateVM(name,newname,ram,cpu){
        return new Promise((resolve, reject) => {
            const comm = `virsh destroy ${name} && virsh domrename ${name} ${newname} && virsh setmaxmem ${name} ${ram} --config && virsh setmem ${name} ${ram} --config && virsh setvcpus ${name} ${cpu} --config`
            exec(comm).then((data)=>{
                resolve(true)
            }).catch((err)=>{
                reject(false)
            })
        })
    }
}


export default VM;