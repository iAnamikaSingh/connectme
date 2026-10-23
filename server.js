const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const rooms = require('./src/rooms');
const routes = require('./src/routes');
const registerSocket = require('./src/socket');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 7e6 });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(routes);

registerSocket(io, rooms);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`connectme running on http://localhost:${PORT}`));
