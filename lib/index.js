// Load modules

var Fs = require('fs');
var Path = require('path');
var Bossy = require('bossy');
var Glue = require('glue');
var Hoek = require('hoek');


// Declare internals

var internals = {};


internals.definition = {
    c: {
        description: 'Manifest json file',
        require: true
    },
    p: {
        description: 'node_modules path'
    },
    r: {
        alias: 'require',
        description: 'A module to be required before the application is loaded',
        multiple: true
    },
    h: {
        alias: 'help',
        description: 'Show help',
        type: 'boolean'
    }
};


internals.loadExtras = function (args) {

    var extras = args.require;

    if (!extras) {
        return;
    }

    var extrasPath;
    var nodeModulesPath = Path.join(process.cwd(), 'node_modules');

    if (args.p) {
        nodeModulesPath = Path.join(Fs.realpathSync(args.p), 'node_modules');
    }

    for (var i = 0, il = extras.length; i < il; i++) {
        var extra = extras[i];
        if (!Hoek.isAbsolutePath(extra)) {
            if (extra[0] === '.') {
                extrasPath = Path.join(process.cwd(), extra);
            }
            else {
                extrasPath = Path.join(nodeModulesPath, extra);
            }
        }
        else {
            extrasPath = extra;
        }

        try {
            require(extrasPath);
        }
        catch (err) {
            console.error('Unable to require extra file: %s (%s)', extra, err.message);
            return err;
        }
    }
};


internals.getManifest = function (args) {

    var manifest = null;
    var manifestPath = Path.resolve(process.cwd(), args.c);

    try {
        manifest = require(manifestPath);
    }
    catch (err) {
        console.log('Failed loading configuration file: %s (%s)', args.c, err.message);
        return err;
    }

    internals.parseEnv(manifest);

    return manifest;
};


internals.loadPacks = function (args, manifest, callback) {

    var options = {};

    if (!args.p) {
        return callback(null, options);
    }

    Fs.realpath(args.p, function (err, path) {

        if (err) {
            return callback(err);
        }

        options = { relativeTo: path };
        callback(null, options);
    });
};


internals.parseEnv = function (manifest) {

    if (!manifest ||
        typeof manifest !== 'object') {

        return;
    }

    Object.keys(manifest).forEach(function (key) {

        var value = manifest[key];
        if (typeof value === 'string' &&
            value.indexOf('$env.') === 0) {

            manifest[key] = process.env[value.slice(5)];
        }
        else {
            internals.parseEnv(value);
        }
    });
};


exports.start = function (options) {

    var args = Bossy.parse(internals.definition, {
        argv: options.args
    });

    if (args instanceof Error) {
        console.error(Bossy.usage(internals.definition, 'rejoice -c manifest.json [-p node_modules_path -r pre_load_module]'));
        return process.exit(1);
    }

    if (args.h) {
        console.log(Bossy.usage(internals.definition, 'rejoice -c manifest.json [-p node_modules_path -r pre_load_module]'));
        return process.exit(1);
    }

    if (internals.loadExtras(args) instanceof Error) {
        return process.exit(1);
    }

    var manifest = internals.getManifest(args);

    if (manifest instanceof Error) {
        return process.exit(1);
    }

    internals.loadPacks(args, manifest, function (err, packOptions) {

        if (err) {
            console.error(err);
            return process.exit(1);
        }

        Glue.compose(manifest, packOptions, function (err, server) {

            Hoek.assert(!err, 'Failed loading plugins: ' + (err && err.message));

            server.start(function (err) {

                Hoek.assert(!err, 'Failed starting server: ' + (err && err.message));

                // Use kill -s QUIT {pid} to kill the servers gracefully

                process.once('SIGQUIT', function () {

                    server.stop(function () {

                        process.exit(0);
                    });
                });

                // Use kill -s SIGUSR2 {pid} to restart the servers

                process.on('SIGUSR2', function () {

                    console.log('Stopping...');
                    server.stop(function () {

                        console.log('Starting...');
                        exports.start(options);
                    });
                });
            });
        });
    });
};
