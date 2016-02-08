module.exports = RegistrarSQL

var hexString = require('hex-string')
var getRandomValues = require('get-random-values')

function RegistrarSQL (connectionPool) {
  this.connectionPool = connectionPool
}

RegistrarSQL.prototype.getChallenge = function (cb) {
  getTransaction(this.connectionPool, cb, function (connection, cb) {
    generateChallenge()
    function generateChallenge () {
      var challenge = getRandomValues(new Uint8Array(64))
      var q = "INSERT INTO `challenges` (challenge) VALUES (X'" + hexString.encode(challenge) + "')"
      connection.query(q, function (err, result) {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY') return generateChallenge()
          return cb(err)
        }
        cb(null, challenge)
      })
    }
  })
}

RegistrarSQL.prototype.register = function (challenge, publicKeyHashes, factorCount, cb) {
  getTransaction(this.connectionPool, cb, function (connection, cb) {
    repudiate(connection, challenge, publicKeyHashes, function (err, hexEncodedPublicKeyHashes) {
      if (err) return cb(err)
      var q = "INSERT INTO `identities` (`factor_count`) VALUES ('" + factorCount + "')"
      connection.query(q, function (err, result) {
        if (err) return cb(err)
        var id = result.insertId
        q = "INSERT INTO `public_key_hashes` (`hash`, `identity_id`) VALUES " + hexEncodedPublicKeyHashes.map(function (hexEncodedHash) {
          return "(" + hexEncodedHash + ",'" + id + "')"
        }).join(',')
        connection.query(q, function (err, result) {
          if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
              err = new Error('already registered')
            }
            return cb(err)
          }
          cb(null, id + '')
        })
      })
    })
  })
}

RegistrarSQL.prototype.authenticate = function (challenge, publicKeyHashes, cb) {
  getTransaction(this.connectionPool, cb, function (connection, cb) {
    authenticate(connection, challenge, publicKeyHashes, function (err, id) {
      if (err) return cb(err)
      cb(null, id + '')
    })
  })
}

RegistrarSQL.prototype.deregister = function (challenge, publicKeyHashes, cb) {
  getTransaction(this.connectionPool, cb, function (connection, cb) {
    authenticate(connection, challenge, publicKeyHashes, function (err, id) {
      if (err) return cb(err)
      var q = "DELETE FROM `identities` WHERE `id` = '" + id + "'"
      connection.query(q, function (err, result) {
        if (err) return cb(err)
        cb(null, id  + '')
      })
    })
  })
}

RegistrarSQL.prototype.enumerateCredentials = function (challenge, publicKeyHashes, cb) {
  getTransaction(this.connectionPool, cb, function (connection, cb) {
    authenticate(connection, challenge, publicKeyHashes, function (err, id) {
      if (err) return cb(err)
      var q = "SELECT `hash` FROM `public_key_hashes` WHERE `identity_id` = '" + id + "'"
      connection.query(q, function (err, keys) {
        if (err) return cb(err)
        cb(null, keys.map(function (key) {
          return key.hash
        }))
      })
    })
  })
}

RegistrarSQL.prototype.update = function (challenge, publicKeyHashes, changes, cb) {
  getTransaction(this.connectionPool, cb, function (connection, cb) {
    authenticate(connection, challenge, publicKeyHashes, function (err, id, factorCount) {
      if (err) return cb(err)
      var keysTotal = 0
      var keysAdded = 0
      var keysRemoved = 0
      var n = changes.length + 1
      var q = "SELECT COUNT(*) AS `count` FROM `public_key_hashes` WHERE `identity_id` = '" + id + "'"
      connection.query(q, function (err, results) {
        if (err) return done(err)
        keysTotal = results[0].count
        done()
      })
      changes.forEach(function (change) {
        if (change.publicKey) {
          keysAdded++
          q = "INSERT INTO `public_key_hashes` (`hash`, `identity_id`) VALUES (X'" + change.publicKeyHash.hexRepresentation + "','" + id + "')"
          connection.query(q, done)
        } else if (change.buffer) {
          keysRemoved++
          q = "DELETE FROM `public_key_hashes` WHERE `hash` = X'" + change.hexRepresentation + "' AND `identity_id` = '" + id + "'"
          connection.query(q, done)
        } else {
          factorCount = change
          q = "UPDATE `identities` SET `factor_count` = '" + change + "' WHERE `id` = '" + id + "'"
          connection.query(q, done)
        }
      })
      function done (err) {
        if (!cb) return
        if (err) {
          cb(err)
          cb = null
          return
        }
        if (--n === 0) {
          keysTotal = keysTotal + keysAdded - keysRemoved
          if (keysTotal < factorCount) {
            return cb(new Error('factor count would exceed the number of registered keys'))
          }
          cb()
        }
      }
    })
  })
}

RegistrarSQL.prototype.close = function (cb) {
  this.connectionPool.end(cb)
}

function getTransaction (connectionPool, cb, functionToWrap) {
  connectionPool.getConnection(function (err, connection) {
    if (err) return cb(err)
    connection.beginTransaction(function (err) {
      if (err) return done(err)
      functionToWrap(connection, done)
    })
    function done (err) {
      if (err) connection.rollback()
      else connection.commit()
      connection.release()
      cb.apply(null, arguments)
    }
  }) 
}

function authenticate (connection, challenge, publicKeyHashes, cb) {
  validateChallenge(connection, challenge, function (err) {
    if (err) return cb(err)
    var q = "SELECT `identity_id` FROM `public_key_hashes` WHERE `public_key_hashes`.`hash` IN(" + hexEncodePublicKeyHashes(publicKeyHashes).join(',') + ")"
    connection.query(q, function (err, results) {
      if (err) return cb(err)
      if (results.length === 0) return cb(new Error('unrecognized signature'))
      var i = -1
      var id = undefined
      while (++i < results.length) {
        var result = results[i].identity_id
        if (result === undefined) {
          return cb(new Error('database is inconsistent'))
        } else if (id === undefined) {
          id = result
        } else if (result !== id) {
          return cb(new Error('unrecognized signature'))
        }
      }
      q = "SELECT `factor_count` FROM `identities` WHERE `identities`.`id` = '" + id + "'"
      connection.query(q, function (err, results) {
        if (err) return cb(err)
        if (results.length === 0) return cb(new Error('database is inconsistent'))
        var factorCount = results[0].factor_count
        if (publicKeyHashes.length < factorCount) {
          return cb(new Error(factorCount + ' signatures required'))
        }
        cb(null, id, factorCount)
      })
    })
  })
}

function repudiate (connection, challenge, publicKeyHashes, cb) {
  validateChallenge(connection, challenge, function (err) {
    if (err) return cb(err)
    var hexEncodedPublicKeyHashes = hexEncodePublicKeyHashes(publicKeyHashes)
    var q = "SELECT `identity_id` FROM `public_key_hashes` WHERE `public_key_hashes`.`hash` IN(" + hexEncodedPublicKeyHashes.join(',') + ")"
    connection.query(q, function (err, results) {
      if (err) return cb(err)
      if (results.length !== 0) return cb(new Error('already registered'))
      cb(null, hexEncodedPublicKeyHashes)
    })
  })
}

function validateChallenge (connection, challenge, cb) {
  var q = "DELETE FROM `challenges` WHERE `challenge` = X'" + hexString.encode(challenge) + "' AND NOW() < `created` + 3600"
  connection.query(q, function (err, result) {
    if (err) return cb(err)
    if (result.affectedRows === 0) return cb(new Error('invalid challenge'))
    cb()
  })
}

function hexEncodePublicKeyHashes (hashes) {
  return hashes.map(function (hash) {
    return "X'" + hash.hexRepresentation + "'"
  })
}
