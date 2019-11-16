const async = require('async');
const mysql = require('mysql');
const fs = require('fs');
//Datos de conexión
const connection = mysql.createConnection({
  connectionLimit: 10,
  host: '?',
  user: '?',
  password: '?',
  database: '?',
  port: '?'
});

const request = require('request');
const VisualRecognitionV3 = require('ibm-watson/visual-recognition/v3');

const visualRecognition = new VisualRecognitionV3({
  url: 'https://gateway.watsonplatform.net/visual-recognition/api',
  version: '2018-03-19',
  iam_apikey: '?'
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
                  guardarMySql(insert, function(err, result) {
                    if (err) {
                      console.log('Error guardando en mysql:', err);
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

function guardarMySql(insert, callback) {
  // Use the connection
  connection.query(insert, function(error, results, fields) {
    // Handle error after the release.
    if (error) {
      callback(error, null);
    } else {
      callback(null, results);
    }

    //process.exit();

    // Don't use the connection here, it has been returned to the pool.
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

  let insert = '';

  if (isEmpty(result.images[0].objects)) {
    insert = `INSERT INTO compose.results
      (image_file_name,
      date_of_video,
      time_of_video,
      camera,
      confidence_threshold,
      confidence_watson,
      species_identified,
      mus_musculus_in_frame,
      peromyscus_in_frame,
      time_spent_in_station,
      image_url)
      VALUES
      ("${name}",
      "${date}",
      "${videoFile}",
      "${camera}",
      "0.5",
      "0.0",
      "No species found on the image",
      NULL,
      NULL,
      NULL,
      "${result.images[0].source.source_url}")`;
  } else {
    const location = `Left: ${result.images[0].objects.collections[0].objects[0].location.left}, Top: ${result.images[0].objects.collections[0].objects[0].location.top}, Width: ${result.images[0].objects.collections[0].objects[0].location.width}, Height: ${result.images[0].objects.collections[0].objects[0].location.height}`;
    insert = `INSERT INTO compose.results
      (image_file_name,
      date_of_video,
      time_of_video,
      camera,
      confidence_threshold,
      confidence_watson,
      species_identified,
      mus_musculus_in_frame,
      peromyscus_in_frame,
      time_spent_in_station,
      image_url)
      VALUES
      ("${name}",
      "${date}",
      "${videoFile}",
      "${camera}",
      "0.5",
      "${result.images[0].objects.collections[0].objects[0].score}",
      "${result.images[0].objects.collections[0].objects[0].object}",
      "${
        result.images[0].objects.collections[0].objects[0].object ===
        'Mus_musculus'
          ? location
          : 'NULL'
      }",
      "${
        result.images[0].objects.collections[0].objects[0].object ===
        'Peromyscus_maniculatis'
          ? location
          : 'NULL'
      }",
      NULL,
      "${result.images[0].source.source_url}")`;
  }
  //console.log('insert:', insert);
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
