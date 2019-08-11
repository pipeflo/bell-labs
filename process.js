const async = require('async');
const mysql = require('mysql');
//Datos de conexión
const connection = mysql.createConnection({
  connectionLimit: 10,
  host: '',
  user: '',
  password: '',
  database: '',
  port: ''
});

const request = require('request');
const VisualRecognitionV3 = require('ibm-watson/visual-recognition/v3');

const visualRecognition = new VisualRecognitionV3({
  url: 'https://gateway.watsonplatform.net/visual-recognition/api',
  version: '2018-03-19',
  iam_apikey: '' //API Key
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

//traer imagenes de una carpeta
request(options, function(error, response, body) {
  if (error) {
    console.log('error listando imagenes de carpeta:', error);
  } else {
    //Lista de imagenes, corremos ciclo para procesar cada una
    //console.log('body:', body);
    const images = JSON.parse(body).entries;
    async.eachSeries(
      images,
      function(imagen, callback) {
        //Llamado de Box para generar sharedlink
        const options2 = {
          url: `https:\/\/api.box.com\/2.0\/files\/${imagen.id}`,
          headers: {
            Authorization: `Bearer ${accessToken}`
          },
          json: { shared_link: { access: 'Open' } },
          method: 'PUT'
        };
        console.log('options2:::::', options2);
        //Ejecutamos llamado
        request(options2, function(err, response, body) {
          if (err) {
            console.log('Error creando shared link:', err);
          } else {
            //ya tenemos link de imagen, ahora Llamar watson
            console.log('Shared link:', body.shared_link.download_url);
            const params = {
              url: body.shared_link.download_url,
              classifier_ids: 'BellLabsPOCPeromyscus_969610348'
            };

            visualRecognition
              .classify(params)
              .then(result => {
                //Llamamos a Watson ahora construir insert para bd
                const insert = generarInsert(imagen.name, result);
                console.log('Vamos a insertar:', insert);
                //salvar en mysql
                guardarMySql(insert, function(err, result) {
                  if (err) {
                    console.log('Error guardando en mysql:', err);
                    return callback();
                  } else {
                    return callback();
                  }
                });
                //console.log(JSON.stringify(result, null, 2));
              })
              .catch(err => {
                console.log(err);
              });
          }
        });
      },
      function(err) {
        if (err) console.log('Error final:', err);
        console.log('Done processing');
      }
    );
  }
});

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
    date = values[1];
    camera = values[0];
    videoFile = values[1] + '_' + values[2].substring(0, values[2].length - 7);
  }

  const insert = `INSERT INTO compose.results
  (image_file_name,
  date_of_video,
  time_of_video,
  camera,
  confidence_threshold,
  confidence_watson,
  species_identified,
  mus_musculus_in_frame,
  peromyscus_in_frame,
  time_spent_in_station)
  VALUES
  ("${name}",
  "${date}",
  "${videoFile}",
  "${camera}",
  "0.6",
  "${result.images[0].classifiers[0].classes[0].score}",
  "${result.images[0].classifiers[0].classes[0].class}",
  NULL,
  NULL,
  NULL)`;
  console.log('insert:', insert);
  return insert;
}
