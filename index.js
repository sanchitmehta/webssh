/*
 * WebSSH2 - Web to SSH2 gateway
 * Bill Church - https://github.com/billchurch - April 2016
 * 
 */ 

var express = require('express');
var app = express();
var cookieParser = require('cookie-parser')
var server = require('http').Server(app);
var io = require('socket.io')(server, {path: '/webssh/socket.io'});
var path = require('path');
var fs = require('fs');

var basicAuth = require('basic-auth');
var ssh = require('ssh2');
var readConfig = require('read-config'),
    config = readConfig(__dirname + '/config.json');
var myError = " - ";

function logErrors(err, req, res, next) {
  console.error(err.stack);
  next(err);
}

server.listen({
    host: config.listen.ip,
    port: config.listen.port
}).on('error', function (err) {
    if (err.code === 'EADDRINUSE') {
        config.listen.port++;
        console.log('Address in use, retrying on port ' + config.listen.port);
        setTimeout(function () {
            server.listen(config.listen.port);
        }, 250);
    }
});

app.use(express.static(__dirname + '/webssh/public')).use(function(req, res, next) {
    /*var myAuth = basicAuth(req);
    if (myAuth === undefined) {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm="WebSSH"');
        res.end('Username and password required for web SSH service.');
    } else if (myAuth.name == "") {
        res.statusCode = 401
        res.setHeader('WWW-Authenticate', 'Basic realm="WebSSH"');
        res.end('Username and password required for web SSH service.');
    } else {*/
        config.user.name = 'root';
        config.user.password = 'Docker!';
	config.ssh.port = 2222;
	fs.readFile('/appsvctmp/ipaddr_' + process.env.WEBSITE_ROLE_INSTANCE_ID, 'utf8', function(err, data) {
      if(err)
      {
          fs.readFile('/home/site/ipaddr_' + process.env.WEBSITE_ROLE_INSTANCE_ID, 'utf8', function(err, data) {
              if(err)
              {
                config.ssh.host = 'Couldnt connect to main site container';
              }
              else
              {
                config.ssh.host = data;
                console.log('Host from file: ' + config.ssh.host);
              }
          });
      }
      else
      {
        config.ssh.host = data;
        console.log('Host from file: ' + config.ssh.host);
      }
	});

        next();
    //}
}).use(cookieParser()).get('/webssh/host/:host?', function(req, res) {
    res.sendFile(path.join(__dirname + '/public/client.htm'));
    config.ssh.host = req.params.host;
    console.log('Host: ' + config.ssh.host);
    if (typeof req.query.port !== 'undefined' && req.query.port !== null){ config.ssh.port = req.query.port;}
    if (typeof req.query.header !== 'undefined' && req.query.header !== null){ config.header.text = req.query.header;}
    if (typeof req.query.headerBackground !== 'undefined' && req.query.headerBackground !== null){ config.header.background = req.query.headerBackground;}
    console.log ('webssh2 Login: user=' + config.user.name + ' from=' + req.ip + ' host=' + config.ssh.host + ' port=' + config.ssh.port + ' sessionID=' + req.headers['sessionid'] + ' allowreplay=' + req.headers['allowreplay']);
    console.log ('Headers: ' + JSON.stringify(req.headers));
    config.options.allowreplay = req.headers['allowreplay'];

}).use('/webssh/socket.io', express.static(__dirname + '/node_modules/socket.io-client/dist')).use('/webssh/client.js', express.static(__dirname + '/public/client.js')).use('/webssh/style',express.static(__dirname + '/public')).use('/webssh/src',express.static(__dirname + '/node_modules/xterm/dist')).use('/webssh/addons',express.static(__dirname + '/node_modules/xterm/dist/addons'));

io.on('connection', function(socket) {
    var conn = new ssh();
    conn.on('banner', function(d) {
        //need to convert to cr/lf for proper formatting
        d = d.replace(/\r?\n/g, "\r\n");
        socket.emit('data', d.toString('binary'));
    }).on('ready', function() {
        socket.emit('title', 'ssh://' + config.ssh.host);
        socket.emit('headerBackground', config.header.background);
        socket.emit('header', config.header.text);
        socket.emit('footer', 'ssh://' + config.user.name + '@' + config.ssh.host + ':' + config.ssh.port);
        socket.emit('status', 'SSH CONNECTION ESTABLISHED');
        socket.emit('statusBackground', 'green');
        socket.emit('allowreplay', config.options.allowreplay)
        conn.shell(function(err, stream) {
            if (err) { 
                console.log (err.message);
                myError = myError + err.message
                return socket.emit('status', 'SSH EXEC ERROR: ' + err.message).emit('statusBackground', 'red');
            }
            socket.on('data', function(data) {
                stream.write(data);
            });
            socket.on('control', function(controlData) {
                switch(controlData) {
                    case 'replayCredentials':
                        stream.write(config.user.password + '\n');
                    default:
                        console.log ('controlData: '+ controlData);
                };
            });
            stream.on('data', function(d) {
                socket.emit('data', d.toString('binary'));
            }).on('close', function(code, signal) {
                console.log('Stream :: close :: code: ' + code + ', signal: ' + signal);
                conn.end();
            }).stderr.on('data', function(data) {
                console.log('STDERR: ' + data);
            });
        });
    }).on('end', function() {
        socket.emit('status', 'SSH CONNECTION CLOSED BY HOST' + myError);
        socket.emit('statusBackground', 'red');
    }).on('close', function() {
        socket.emit('status', 'SSH CONNECTION CLOSE' + myError);
        socket.emit('statusBackground', 'red');
    }).on('error', function(err) {
        myError = myError + err
        socket.emit('status', 'SSH CONNECTION ERROR' + myError);
        socket.emit('statusBackground', 'red');
        console.log('on.error' + myError);
    }).on('keyboard-interactive', function(name, instructions, instructionsLang, prompts, finish) {
        console.log('Connection :: keyboard-interactive');
        finish([config.user.password]);
    }).connect({
        host: config.ssh.host,
        port: config.ssh.port,
        username: config.user.name,
        password: config.user.password,
        tryKeyboard: true,
// some cisco routers need the these cipher strings
        algorithms: {
            'cipher': ['aes128-cbc', '3des-cbc', 'aes256-cbc', 'aes128-ctr', 'aes256-ctr', 'aes192-ctr'],
            'hmac': ['hmac-sha1', 'hmac-sha1-96', 'hmac-md5-96']
        }
    });
});