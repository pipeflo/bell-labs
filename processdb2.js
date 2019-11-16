const async = require('async');
const mysql = require('mysql');
const fs = require('fs');
const ibmdb = require('ibm_db');
//Datos de conexión
const db2 = {
  db: '?',
  hostname: '?',
  port: 50000,
  username: '?',
  password: '?'
};
const connString =
  'DRIVER={DB2};DATABASE=' +
  db2.db +
  ';UID=' +
  db2.username +
  ';PWD=' +
  db2.password +
  ';HOSTNAME=' +
  db2.hostname +
  ';port=' +
  db2.port;

const request = require('request');
const VisualRecognitionV3 = require('ibm-watson/visual-recognition/v3');

const visualRecognition = new VisualRecognitionV3({
  url: 'https://gateway.watsonplatform.net/visual-recognition/api',
  version: '2018-03-19',
  iam_apikey: '2n6mILOhEMyG81IfV65nD7thvWpL3pD6PQ3cQuVssDaI'
});

const accessToken = process.argv[2];
const folderId = process.argv[3];

const options = {
  url: `https://api.box.com/2.0/folders/${folderId}/items?limit=1000`,
  method: 'GET',
  headers: {
    Authorization: `Bearer ${accessToken}`
  }
};

let cantidad = 0;

console.log(folderId);
const fileName = folderId + '.txt';

//revisamos si existe un archivo para esta carpeta
try {
  if (fs.existsSync(fileName)) {
    //archivo existe
    procesarArchivo();
  } else {
    //archivo no existe, traemos imagenes de la carpeta
    console.log('NO Existe archivo:', fileName);
    request(options, function(error, response, body) {
      if (error) {
        console.log('error listando imagenes de carpeta:', error);
      } else {
        //Lista de imagenes, corremos ciclo para procesar cada una
        console.log('body:', body);
        const images = JSON.parse(body).entries;
        let listaImagenes = '';
        images.forEach(function(image) {
          listaImagenes = listaImagenes + image.id + '\r\n';
        });
        console.log(listaImagenes);
        fs.writeFile(fileName, listaImagenes, function(err) {
          if (err) throw err;
          console.log('Archivo creado!');
          procesarArchivo();
        });
      }
    });
  }
} catch (err) {
  console.error(err);
}

function procesarArchivo() {
  fs.readFile(fileName, 'utf8', function(err, data) {
    const images = data.split('\r\n');
    const lines = data.split('\r\n');

    console.log('contenido archivo:', images);
    async.eachSeries(
      images,
      function(imagen, callback) {
        console.log('Quedan:', lines.length);
        if (lines.length <= 1) {
          callback(null);
        }
        if (imagen != '') {
          //Llamado de Box para generar sharedlink
          const options2 = {
            url: `https:\/\/api.box.com\/2.0\/files\/${imagen}`,
            headers: {
              Authorization: `Bearer ${accessToken}`
            },
            json: { shared_link: { access: 'Open' } },
            method: 'PUT'
          };
          //console.log('options2:::::', options2);
          //Ejecutamos llamado
          request(options2, function(err, response, body) {
            if (err) {
              console.log('Error creando shared link:', err);
              callback(err);
            } else {
              //ya tenemos link de imagen, ahora Llamar watson
              //console.log('Datos Imagen:', body);
              const datosImagen = body;

              //Llamado a Version 4 de Recognition
              const options3 = {
                url: `https:\/\/gateway.watsonplatform.net\/visual-recognition\/api\/v4\/analyze?version=2019-02-11`,
                formData: {
                  collection_ids: '1a8f33cd-0b42-4eac-80e3-04c6d1bf57c5',
                  features: 'objects',
                  image_url: body.shared_link.download_url,
                  threshold: 0.15
                },

                method: 'POST',
                auth: {
                  user: 'apikey',
                  password: '?'
                }
              };

              request(options3, function(err, response, body) {
                if (err) {
                  console.log('Error en llamado a V4 Watson:', err);
                  callback(err);
                } else {
                  //console.log('Respuesta Watson V4:', body);
                  const result = JSON.parse(body);
                  const insert = generarInsert(datosImagen.name, result);
                  //console.log('Vamos a insertar:', insert);
                  guardarDB2(insert, function(err, result) {
                    if (err) {
                      console.log('Error guardando en DB2 out:', err);
                      return callback(err);
                    } else {
                      //eliminar linea del archivo
                      lines.splice(lines.indexOf(imagen), 1);
                      guardarArchivo(lines);
                      return callback();
                    }
                  });
                }
              });
            }
          });
        }
      },
      function(err) {
        if (err) {
          console.log('Error final:', err);
        } else {
          console.log('Done processing');
        }
      }
    );
  });
}

function guardarArchivo(lines) {
  console.log('Guardando archivo para registro de carga.');
  const newText = lines.join('\r\n');
  fs.writeFile(fileName, newText, function(err) {
    if (err) throw err;
    //console.log('Archivo creado!');
  });
}

function guardarDB2(insert, callback) {
  //open DB2 connection
  ibmdb.open(connString, function(err, conn) {
    if (err) {
      res.send('error occurred ' + err.message);
    } else {
      conn.prepare(insert.sql, function(err, stmt) {
        if (err) {
          //could not prepare for some reason
          console.log('Error preparando statement:', err);
          return conn.closeSync();
        }

        //Bind and Execute the statment asynchronously
        stmt.execute(insert.values, function(err, result) {
          if (err) {
            console.log('Error insertando en DB2:', err);
            //Close the connection
            conn.close(function(err) {});
            callback(err, null);
          } else {
            result.closeSync();
            //Close the connection
            conn.close(function(err) {});
            callback(null, result);
          }
        });
      });
    }
  });
}

function generarInsert(name, result) {
  const values = name.split('_');
  let videoFile = '';
  let date = '';
  let camera = '';
  if (values.length <= 2) {
    videoFile = values[0].replace('CAM G', '');
    videoFile = videoFile.replace(' ', '');
    date = videoFile;
    videoFile = date + '_' + values[1].substring(0, values[1].length - 7);
  } else {
    date = values[2];
    camera = values[0] + ' ' + values[1];
    videoFile = values[2] + '_' + values[3].substring(0, values[2].length - 7);
  }
  let insert = {};

  insert.sql = `INSERT
  INTO  BELLLABS.RESULTS (IMAGE_FILE_NAME,DATE_OF_VIDEO,TIME_OF_VIDEO,CAMERA,CONFIDENCE_THRESHOLD,CONFIDENCE_WATSON,SPECIES_IDENTIFIED,MUS_MUSCULUS_IN_FRAME,PEROMYSCUS_IN_FRAME,TIME_SPENT_IN_STATION,IMAGE_URL) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  if (isEmpty(result.images[0].objects)) {
    insert.values = [
      name,
      date,
      videoFile,
      camera,
      '0.5',
      '0.0',
      'No species found on the image',
      'NULL',
      'NULL',
      'NULL',
      result.images[0].source.source_url
    ];
  } else {
    const location = `Left: ${result.images[0].objects.collections[0].objects[0].location.left}, Top: ${result.images[0].objects.collections[0].objects[0].location.top}, Width: ${result.images[0].objects.collections[0].objects[0].location.width}, Height: ${result.images[0].objects.collections[0].objects[0].location.height}`;
    insert.values = [
      name,
      date,
      videoFile,
      camera,
      '0.5',
      result.images[0].objects.collections[0].objects[0].score.toString(),
      result.images[0].objects.collections[0].objects[0].object,
      result.images[0].objects.collections[0].objects[0].object ===
      'Mus_musculus'
        ? location
        : 'NULL',
      result.images[0].objects.collections[0].objects[0].object ===
      'Peromyscus_maniculatis'
        ? location
        : 'NULL',
      'NULL',
      result.images[0].source.source_url
    ];
  }
  console.log('insert:', insert.sql);
  console.log('values:', insert.values);
  return insert;
}

function isEmpty(obj) {
  for (var prop in obj) {
    if (obj.hasOwnProperty(prop)) {
      return false;
    }
  }

  return JSON.stringify(obj) === JSON.stringify({});
}
