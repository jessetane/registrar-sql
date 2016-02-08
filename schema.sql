CREATE TABLE `identities` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `factor_count` tinyint(4) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE `public_key_hashes` (
  `hash` varbinary(64) NOT NULL,
  `identity_id` int(11) NOT NULL,
  PRIMARY KEY (`hash`),
  KEY `identity_id` (`identity_id`),
  CONSTRAINT `fk__public_key_hashes__identity_id__identities__id` FOREIGN KEY (`identity_id`) REFERENCES `identities` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE `challenges` (
  `challenge` varbinary(64) NOT NULL,
  `created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`challenge`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
