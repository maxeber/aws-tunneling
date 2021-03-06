const MONGODB = require('mongodb')
const { promisify } = require('util')
const TUNNEL = promisify(require('tunnel-ssh'))
const JOI = require('joi')
const HTTPError = require('node-http-error')
const DEBUG = require('debug')('mongodb-aws-documentdb-tunneling.remote')

/**
 * Connect mongodb with AWS DocumentDB.
 * @param {MongoDBRemoteOptions} options
 * @returns {MONGODB.MongoClient}
 */
module.exports.connect = async options => {

    DEBUG('Connecting to remote MongoDB.')

    const optionsValidation = JOI
        .object()
        .keys({
            env: JOI.string().allow('remote').required(),
            makeTunnel: JOI.boolean().required(),
            sslCA: JOI.string().required(),
            vpcTunnelEC2Username: JOI.string().required(),
            vpcTunnelEC2Host: JOI.string().required(),
            vpcTunnelEC2Port: JOI.number().required(),
            vpcTunnelEC2PortLocal: JOI.number().required(),
            vpcTunnelEC2PrivateKey: JOI.string().required(),
            documentdbClusterEndpoint: JOI.string().required(),
            documentdbClusterPort: JOI.number().required(),
            documentdbClusterDbName: JOI.string().required(),
            documentdbClusterUsername: JOI.string().required(),
            documentdbClusterPassword: JOI.string().required(),
            documentdbEndpoint: JOI.string().required(),
            documentdbPort: JOI.number().required(),
        })
        .validate(options)
    if (optionsValidation.error) throw optionsValidation.error

    return options.makeTunnel
        ? _connectThroughSSHTunnel(options)
        : _connect(options)
}

/**
 * Make an ssh tunnel that forward calls to DocumentDB to a EC2 instance that is
 * in the same VPC as the DocumentDB cluster.
 * @param {MongoDBRemoteOptions} options
 */
async function _connectThroughSSHTunnel(options) {

    DEBUG('Client is outside VPC, connecting to cluster through SSH tunnel.')

    const tunnelConfigurations = {
        username: options.vpcTunnelEC2Username,
        host: options.vpcTunnelEC2Host,
        port: options.vpcTunnelEC2Port,
        privateKey: options.vpcTunnelEC2PrivateKey,
        dstHost: options.documentdbClusterEndpoint,
        dstPort: options.documentdbClusterPort,
        localPort: options.vpcTunnelEC2PortLocal,
    }

    const tunnel = await TUNNEL(tunnelConfigurations)
        .catch(err => err)
    if (tunnel instanceof Error) return Promise.reject(
        new HTTPError(500, 'Error. Could not create SSH tunnel.', { error: tunnel, options })
    )

    DEBUG(`Tunnel listening on port ${options.vpcTunnelEC2PortLocal}.`)

    /**
     * @type {MONGODB.MongoClientOptions} MongoDB connection options.
     */
    const mongoDBOptions = {
        useNewUrlParser: true,
        ssl: true,
        sslCA: options.sslCA,
        auth: {
            user: options.documentdbClusterUsername,
            password: options.documentdbClusterPassword,
        },
    }
    const {
        documentdbClusterUsername: user,
        documentdbClusterPassword: pass,
        documentdbEndpoint: endpoint,
        vpcTunnelEC2PortLocal: port,
    } = options
    const uri = `mongodb://${user}:${pass}@${endpoint}:${port}`

    DEBUG(`Connecting to ${uri}.`)

    return MONGODB.connect(uri, mongoDBOptions)
        .then(
            client => Promise.resolve({
                message: 'Connected to remote DocumentDB through our EC2 ssh tunnel with MongoDB.',
                client: client,
            })
        )
        .catch(
            error => Promise.reject(new HTTPError(
                500, 'Error. Could not connect to remote DocumentDB through our EC2 ssh tunnel with MongoDB.',
                { error, uri, mongoDBOptions },
            ))
        )
}

/**
 * Directly connet to the DocumentDB cluster. Works if your applications live in the same
 * in the same VPC as the DocumentDB cluster.
 * @param {MongoDBRemoteOptions} options
 */
function _connect({
    documentdbClusterUsername: user,
    documentdbClusterPassword: pass,
    documentdbClusterEndpoint: endpoint,
    documentdbClusterPort: port,
    sslCA: sslCA,
}) {

    DEBUG('Client is inside VPC, connecting directly to cluster.')

    /**
     * @type {MONGODB.MongoClientOptions} MongoDB connection options.
     */
    const mongoDBOptions = {
        useNewUrlParser: true,
        ssl: true,
        sslCA,
        auth: {
            user,
            password: pass,
        },
    }
    const uri = `mongodb://${user}:${pass}@${endpoint}:${port}`

    return MONGODB.connect(uri, mongoDBOptions)
        .then(
            client => Promise.resolve({
                message: 'Connected to remote DocumentDB with MongoDB.',
                client: client,
            })
        )
        .catch(
            error => Promise.reject(new HTTPError(
                500, 'Error. Could not connect to remote DocumentDB with MongoDB.',
                { error, uri, mongoDBOptions },
            ))
        )
}


/**
 * @typedef MongoDBRemoteOptions
 * @type {{
 *     env: 'remote',
 *     makeTunnel: boolean,
 *     sslCA: string,
 *     vpcTunnelEC2Username: string,
 *     vpcTunnelEC2Host: string,
 *     vpcTunnelEC2Port: number,
 *     vpcTunnelEC2PortLocal: number,
 *     vpcTunnelEC2PrivateKey: string,
 *     documentdbClusterEndpoint: string,
 *     documentdbClusterPort: number,
 *     documentdbClusterDbName: string,
 *     documentdbClusterUsername: string,
 *     documentdbClusterPassword: string,
 *     documentdbEndpoint: string,
 *     documentdbPort: number,
 * }}
 */
