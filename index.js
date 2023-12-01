/* const ipfsClient = require('ipfs-http-client');
const { globSource } = ipfsClient;
const ipfsEndPoint = 'http://localhost:5001'
const ipfs = ipfsClient(ipfsEndPoint); */


const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const util = require('util');
const axios = require('axios');
const { Transform } = require('stream'); 
const readdir = util.promisify(fs.readdir);
const statAsync = util.promisify(fs.stat);
const rename = util.promisify(fs.rename);
const unlinkFile = util.promisify(fs.unlink);

////////////////////////////////
//////////// IPFS //////////////
////////////////////////////////

generateKeys()
//_testing()

// this should work without streaming
// pulls current ipfs files stored on flux and encrypts them
// saves the encrypted file to encrypted/data/<hash>
//encryptFileIPFS("QmNVKKALYCsseoaQaQe5XyDZxubypfaK3JFG2K2DoSWJLu");
//encryptFileIPFS("QmZsM5XPUq5mBrxQopWD7pUX6ythmb5Q9XREpCeGBUcWn3");
//encryptFileIPFS("QmPJ7vpJKnr1msgndBvq5QM9LDvT85r9xxv4VXNLdf9KMB");

/**
 * Downloand file from ipfs client and encrypt the contents
 * Save encrypted data to local disk
 * @param {string} hash 
 */
async function encryptFileIPFS(hash) {
  try {
    const ipfs_request = await axios.get(`https://jetpack2_38080.app.runonflux.io/ipfs/${hash}`,
    { 
      responseType: 'arraybuffer',
    });

    const buff = await ipfs_request.data;

    const key = crypto.randomBytes(16).toString('hex'); // 16 bytes -> 32 chars
    const iv = crypto.randomBytes(8).toString('hex');   // 8 bytes -> 16 chars
    const ekey = encryptRSA(key); // 32 chars -> 684 chars
    const ebuff = encryptAES(buff, key, iv);

    const content = Buffer.concat([ // headers: encrypted key and IV (len: 700=684+16)
      Buffer.from(ekey, 'utf8'),   // char length: 684
      Buffer.from(iv, 'utf8'),     // char length: 16
      Buffer.from(ebuff, 'utf8')
    ])
    
    fs.writeFileSync(`encrypted/data/${hash}`, content);   
  } catch (error) {
    console.log(JSON.stringify(error));
  }
}

/**
 * Ingest file and encrypt using random key and iv then save to local device
 * @param {string} file - path to file 
 * @param {*} ipfspath - path to save encrypted file data
 * @returns buffer which includes key, iv and encrypted content
 */
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

/**
 * Decrypt local file
 * @param {string} ipfspath - path of encrypted file
 * @param {Object} res - http response
 * @returns buffer of decrypted file contents
 */
async function downloadFileEncrypted(ipfspath, res) {
  try {

    // only reads parts of the file that contain the key to avoid loading the entire file to memory
    // 0-683 key 684-699 iv 700-EOF data 
    let keyBuff = Buffer.alloc(684);
    let ivBuff = Buffer.alloc(16);

    fs.open(ipfspath, 'r', async function(error, fd) {
      if (error) {
        console.log(error.message);
        return res.status(500);
      }
      fs.readSync(fd, keyBuff, 0, 684, 0, function(err, num) {
        if (err) {
          console.log(err.message ?? error);
          return res.status(500);
        }
        console.log(keyBuff.toString('utf8', 0, num));
      });
      fs.readSync(fd, ivBuff, 0, 16, 684, function(err, num) {
        if (err) {
          console.log(err.message ?? error);
          return res.status(500);
        }
        console.log(ivBuff.toString('utf8', 0, num));
      });

      const key = decryptRSA(keyBuff.toString('utf8'))
      const iv = ivBuff.toString('utf8');

      /* OLD CODE FROM MEMORY
      const econtent = Buffer.from(file_data.subarray(700).toString('utf8'), `hex`)
      const content = decryptAES(econtent, key, iv)
      */

      console.log(' ')
      console.log('DECRYPTION Strem --------')
      console.log('key:', keyBuff, 'iv:', ivBuff)

      await decryptFileAES(ipfspath, key, iv, res);
      //return res.status(200);
  });

    /* let file_data = await ipfs.files.read(ipfspath); */
    //let file_data = await readFile(ipfspath);

    //const keyFile = decryptRSA(file_data.subarray(0, 684).toString('utf8'))
    //const ivFile = file_data.subarray(684, 700).toString('utf8')    
    
    //console.log('contents:', content.length, 'encrypted:', econtent.length)

    //content.pipe(res);
    //return content
    
  } catch (err) {
    console.log(err);
    res.status(500);
    throw err;
  }
}

/**
 * Returns a list of objectrs in the ipfspath directory with file descriptions/size
 * @param {string} ipfspath - optional directory path to list files 
 * @returns array -  `const files = [ { path: "test1.png", "size: 1024" }, { path: "test1.png", "size: 1024" } ];`
 */
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
        size: `${(await statAsync(ipfspath + file)).size} bytes`,
        //cid: file.cid.toString() ?? "n/a"
      })
    }
  }
  return files
}

/**
 * 
 * @param {buffer} buffer - data to encrypt
 * @param {buffer} secretKey - encryption key
 * @param {buffer} iv - initilization vector
 * @returns hex encoded string
 */
function encryptAES(buffer, secretKey, iv) {
  const cipher = crypto.createCipheriv('aes-256-ctr', secretKey, iv);
  const data = cipher.update(buffer);
  const encrypted = Buffer.concat([data, cipher.final()]);
  return encrypted.toString('hex')
}

/**
 * Ingest decrypted file and transform data as input to decryption stream. Decrypted data stream then piped to http res
 * @param {String} filePath - file path to encrypted file
 * @param {Buffer} secretKey - secret key buffer
 * @param {Buffer} iv - initilization vector buffer
 * @param {Object} res - http response
 * @returns streams decrypted contents to res or returns error
 */
async function decryptFileAES(filePath, secretKey, iv, res) {
  try {
    const hexEncode = new Transform({
      transform(chunk, encoding, callback) {
        callback(null, Buffer.from(chunk.toString(), 'hex'));
      },
    });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename=decrypted_file');
    const inputStream = fs.createReadStream(filePath, { start: 700 });
    const decipher = crypto.createDecipheriv('aes-256-ctr', secretKey, iv);
    inputStream.pipe(hexEncode).pipe(decipher).pipe(res);    
  } catch (error) {
    return res.status(500).json({ message: "error proessing decryption" });
  }
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
const { Stream } = require('stream');

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
    //res.send(await downloadFileEncrypted(ipfspath));
    await downloadFileEncrypted(ipfspath, res);
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
