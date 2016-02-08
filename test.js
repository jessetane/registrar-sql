var fs = require('fs')
var mysql = require('mysql')
var Storage = require('./')

var databases = new Map()
var connectionPool = mysql.createPool(createConfig())
var schema = fs.readFileSync(__dirname + '/schema.sql', 'utf8').split(';').filter(function (q) {
  return q.trim() !== ''
})

require('registrar/test')(createStorage)

function createStorage (cb) {
  connectionPool.getConnection(function (err, connection) {
    if (err) return cb(err)
    createDatabase(connection, cb)
  })
}

function createDatabase (connection, cb) {
  var name = generateUniqueDatabaseName()
  var q = "CREATE DATABASE `" + name + "` COLLATE utf8_unicode_ci"
  connection.query(q, function (err) {
    if (err) return cb(err)
    connection.release()
    createDatabaseConnectionPool(name, cb)
  })
}

function createDatabaseConnectionPool (name, cb) {
  var pool = mysql.createPool(createConfig(name))
  databases.set(name, pool)
  pool.getConnection(function (err, connection) {
    if (err) return cb(err)
    var n = schema.length
    schema.forEach(function (q) {
      connection.query(q, ready)
    })
    function ready (err) {
      if (!cb) return
      if (err) {
        cb(err)
        cb = null
        return
      }
      if (--n === 0) {
        var storage = new Storage(pool)
        storage.getIdentityCount = getIdentityCount
        storage.close = close
        cb(null, storage)
      }
    }
  })
}

function getIdentityCount (cb) {
  this.connectionPool.getConnection(function (err, connection) {
    if (err) throw err
    connection.query("SELECT COUNT(*) AS `count` FROM `identities`", function (err, results) {
      connection.release()
      cb(err, results[0].count)
    })
  })
}

function close () {
  var name = this.connectionPool.config.connectionConfig.database
  Storage.prototype.close.call(this, function (err) {
    if (err) throw err
    dropDatabase(name)
  })
}

function dropDatabase (name) {
  connectionPool.getConnection(function (err, connection) {
    if (err) throw err
    var q = "DROP DATABASE `" + name + "`"
    connection.query(q, function (err) {
      if (err) throw err
      connection.release()
      databases.delete(name)
      if (databases.size === 0) {
        connectionPool.end()
      }
    })
  })
}

function createConfig (name) {
  return {
    host: process.env.HOST || 'mysql.dev',
    port: process.env.PORT || '3306',
    user: process.env.USERNAME || 'root',
    password: process.env.PASSWORD || 'root',
    database: name
  }
}

function generateUniqueDatabaseName () {
  var name = String(Math.random()).slice(2)
  while (databases.has(name)) return generateUniqueDatabaseName()
  databases.set(name, null)
  return name
}
