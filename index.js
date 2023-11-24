/* const ipfsClient = require('ipfs-http-client');
const { globSource } = ipfsClient;
const ipfsEndPoint = 'http://localhost:5001'
const ipfs = ipfsClient(ipfsEndPoint); */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const util = require('util');
const readdir = util.promisify(fs.readdir);
const statAsync = util.promisify(fs.stat);
const rename = util.promisify(fs.rename);
const unlinkFile = util.promisify(fs.unlink);

////////////////////////////////
//////////// IPFS //////////////
////////////////////////////////

generateKeys()
//_testing()


async function uploadFileEncrypted(file, ipfspath) {
  try {
    const buff = fs.readFileSync(file);
    const key = crypto.randomBytes(16).toString('hex'); // 16 bytes -> 32 chars
    const iv = crypto.randomBytes(8).toString('hex');   // 8 bytes -> 16 chars
    const ekey = encryptRSA(key); // 32 chars -> 684 chars
    const ebuff = encryptAES(buff, key, iv);

    const content = Buffer.concat([ // headers: encrypted key and IV (len: 700=684+16)
      Buffer.from(ekey, 'utf8'),   // char length: 684
      Buffer.from(iv, 'utf8'),     // char length: 16
      Buffer.from(ebuff, 'utf8')
    ])
    
    /* await ipfs.files.write(
      ipfspath,
      content,
      {create: true, parents: true}
    ); */
    fs.writeFileSync(ipfspath, content);

    console.log('ENCRYPTION --------')
    console.log('key:', key, 'iv:', iv, 'ekey:', ekey.length)
    console.log('contents:', buff.length, 'encrypted:', ebuff.length)
    console.log(' ')

    return content
    
  } catch (err) {
    console.log(err)
    throw err;
  }
}

async function toArray(asyncIterator) { 
  const arr=[]; 
  for await(const i of asyncIterator) {
    arr.push(i); 
  }
  return arr;
}

async function downloadFileEncrypted(ipfspath) {
  try {
    /* let file_data = await ipfs.files.read(ipfspath); */
    let file_data = await readFile(ipfspath);

    let edata = [];

    console.log(file_data);

    for await (const chunk of file_data) {
      edata.push(Buffer.from([chunk]));
    }    
    edata = Buffer.concat(edata);

    const key = decryptRSA(edata.slice(0, 684).toString('utf8'))
    const iv = edata.slice(684, 700).toString('utf8')
    const econtent = edata.slice(700).toString('utf8')
    const ebuf = Buffer.from(econtent, 'hex')
    const content = decryptAES(ebuf, key, iv)

    console.log(' ')
    console.log('DECRYPTION --------')
    console.log('key:', key, 'iv:', iv)
    console.log('contents:', content.length, 'encrypted:', econtent.length)
    console.log('downloaded:', edata.length)
    
    return content
    
  } catch (err) {
    console.log(err)
    throw err;
  }
}

async function getUploadedFiles(ipfspath='encrypted/data/') {
  let files = []
  //const arr = await toArray(ipfs.files.ls(ipfspath))
  let arr = [];

  try {
    arr = await readdir(ipfspath, {});
    // Do something with arr here
  } catch (err) {
    console.error('Error reading directory:', err);
  }

  console.log(arr);

  for (let file of arr) {
    if (file.type === 'directory') {
      const inner = await getUploadedFiles(ipfspath + file.name + '/')
      files = files.concat(inner)
    } else {
      files.push({
        path: ipfspath + file,
        size: (await statAsync(ipfspath + file)).size,
        //cid: file.cid.toString() ?? "n/a"
      })
    }
  }
  return files
}

function encryptAES(buffer, secretKey, iv) {
  const cipher = crypto.createCipheriv('aes-256-ctr', secretKey, iv);
  const data = cipher.update(buffer);
  const encrypted = Buffer.concat([data, cipher.final()]);
  return encrypted.toString('hex')
}

async function encryptFileAES(filePath, secretKey, iv, ipfspath) {
  const inputStream = fs.createReadStream(filePath);
  const outputStream = fs.createWriteStream(ipfspath);
  const cipher = crypto.createCipheriv('aes-256-ctr', secretKey, iv);
  inputStream.pipe(cipher).pipe(outputStream);
}

function decryptAES(buffer, secretKey, iv) {
  const decipher = crypto.createDecipheriv('aes-256-ctr', secretKey, iv);
  const data = decipher.update(buffer)
  const decrpyted = Buffer.concat([data, decipher.final()]);
  return decrpyted;
}

function generateKeys() {
  if (fs.existsSync('private.pem') && fs.existsSync('public.pem'))
    return;
  
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: {
      type: 'pkcs1',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs1',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase: '',
    },
  })

  fs.writeFileSync('private.pem', privateKey)
  fs.writeFileSync('public.pem', publicKey)
}

function encryptRSA(toEncrypt, pubkeyPath='public.pem') {
  const absolutePath = path.resolve(pubkeyPath)
  const publicKey = fs.readFileSync(absolutePath, 'utf8')
  const buffer = Buffer.from(toEncrypt, 'utf8')
  const encrypted = crypto.publicEncrypt(publicKey, buffer)
  return encrypted.toString('base64')
}

function decryptRSA(toDecrypt, privkeyPath='private.pem') {
  const absolutePath = path.resolve(privkeyPath)
  const privateKey = fs.readFileSync(absolutePath, 'utf8')
  const buffer = Buffer.from(toDecrypt, 'base64')
  const decrypted = crypto.privateDecrypt(
  {
    key: privateKey.toString(),
    passphrase: '',
  },
  buffer,
  )
  return decrypted.toString('utf8')
}

async function _testing() {
  const file = 'package.json'  // file to upload
  const ipfspath = 'encrypted/data/' + file // ipfspath
  
  // upload to ipfs path
  await uploadFileEncrypted(file, ipfspath)
  
  // download from ipfs path
  const dl = await downloadFileEncrypted(ipfspath)
  
  // to buffer
  const buff = Buffer.from(dl, 'hex')

  // save buffer to file
  const outfile = ipfspath.replace(/\//g, '_');
  console.log('writing:', outfile)
  fs.writeFile(outfile, buff, function(err) {
    if (err) throw err;
  })
} 

////////////////////////////////
///////// REST API /////////////
////////////////////////////////

const rest_port = 3000;
const express = require("express");
const { readFile } = require('fs/promises');
const app = express();
const formidable = require('formidable');

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.get("/api/files", async (req, res, next) => {
  try {
    res.json(await getUploadedFiles())
  } catch (e) {
    // when /encrypted/ path not exists (~ no uploads): catch ipfs http error
    res.json({error: e.toString()})
  }
});

app.get(/^\/api\/file(\/.*)$/, async (req, res, next) => {
  try {
    const ipfspath = req.params[0].slice(1);
    const content = await downloadFileEncrypted(ipfspath);
    res.send(content)
  } catch (err) {
    res.send('error: ' + err)
  }
});

app.post('/api/file/upload', (req, res) => {
  const form = new formidable.IncomingForm();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      return res.status(500).json({ error: 'Error parsing the form data.' });
    }

    const uploadedFiles = files.file; // 'file' corresponds to the name attribute of the file input field
    let encryptedFiles = [];

    for (let index = 0; index < uploadedFiles.length; index++) {
      const uploadedFile = uploadedFiles[index];
      if (!uploadedFile) {
        return res.status(400).json({ error: 'No file uploaded.' });
      }
  
      // Do something with the file (e.g., save it, process it, etc.)
      // For example, move the file to a desired location
      const newFilePath = __dirname + '/uploads/' + uploadedFile.originalFilename;
  
      console.log(uploadedFile.filepath);
      console.log(newFilePath);
      
      try {
        await rename(uploadedFile.filepath, newFilePath);
        const newContent = await uploadFileEncrypted(`uploads/${uploadedFile.originalFilename}`, `encrypted/data/${uploadedFile.originalFilename}`);
        encryptedFiles.push({filename: uploadedFile.originalFilename, content: newContent });
        await unlinkFile(newFilePath);
      } catch (error) {
        console.log(error);
      }
    }

    res.status(200).json(encryptedFiles);    
  });
});

app.listen(rest_port, () => {
 console.log("Server running on port 3000");
});

////////////////////////////////
////////////////////////////////
////////////////////////////////
