'use strict';

const fs = require('fs');
const path = require('path');
const url = require('url');

const body_parser = require('body-parser');
const ws_module = require('ws');
const express = require('express');
const favicon = require('serve-favicon');

const admin = require('./admin');
const bupws = require('./bupws');
const database = require('./database');
const error_reporting = require('./error_reporting');
const http_api = require('./http_api');
const utils = require('./utils');
const wshandler = require('./wshandler');

function read_config(callback, autocreate) {
	fs.readFile('config.json', 'utf8', (err, config_json) => {
		if (autocreate && err && (err.code === 'ENOENT')) {
			utils.copy_file('config.json.default', 'config.json', function(err) {
				if (err) return callback(err);

				console.log('Created default configuration in ' + path.resolve('config.json'));
				read_config(callback, false);
			});
			return;
		}
		if (err) return callback(err);

		const config = JSON.parse(config_json);
		callback(err, config);
	});
}

function main() {
	read_config((err, config) => {
		if (err) throw err;

		error_reporting.setup(config);

		database.init(db => run_server(config, db));
	}, true);
}

function cadmin_router() {
	const router = express.Router();
	router.use(function(req, res, next) {
		fs.readFile(path.join(__dirname, 'static/cbts.html'), 'utf8', function(err, html) {
			if (err) return next(err);
			res.set('Content-Type: text/html');
			res.set('Cache-Control: no-cache, no-store, must-revalidate');
			res.set('Pragma: no-cache');
			res.set('Expires: 0');

			html = html.replace(/{{error_reporting}}/g, JSON.stringify(error_reporting.active(req.app.config)));
			html = html.replace(/{{static_path}}/g, '/static/');
			html = html.replace(/{{root_path}}/g, '/');
			html = html.replace(/{{app_root}}/g, '/admin/');
			res.send(html);
		});
	});
	return router;
}

function run_server(config, db) {
	const server = require('http').createServer();
	const app = express();
	const wss = new ws_module.Server({server: server});

	app.config = config;
	app.db = db;
	app.wss = wss;

	app.use('/bup/', express.static(config.bup_location, {index: config.bup_index}));
	app.use('/static/', express.static('static/', {}));
	app.use('/admin/', cadmin_router());
	app.get('/', function(req, res) {
		res.redirect('/admin/');
	});
	app.use(favicon(__dirname + '/static/icons/favicon.ico'));

	app.use(body_parser.json());
	app.get('/h/:tournament_key/courts', http_api.courts_handler);
	app.get('/h/:tournament_key/matches', http_api.matches_handler);
	app.post('/h/:tournament_key/m/:match_id/score', http_api.score_handler);

	wss.on('connection', function connection(ws) {
		const location = url.parse(ws.upgradeReq.url, true);
		if (location.path === '/ws/admin') {
			return wshandler.handle(admin, app, ws);
		} else if (location.path === '/ws/bup') {
			return wshandler.handle(bupws, app, ws);
		} else {
			ws.send(JSON.stringify({
				type: 'error',
				message: 'Unsupported location ' + location.path,
			}));
			ws.close();
		}
	});

	server.on('request', app);
	server.listen(config.port, function () {
		// console.log('Listening on ' + server.address().port);
	});
}

main();
