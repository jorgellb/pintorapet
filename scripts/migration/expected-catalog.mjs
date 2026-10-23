/** Canonical audit table from PROMPT §2.2 / §2.3 / Anexo A. */

export const CATEGORY_BY_LABEL = {
  Tarjeta: 'greeting-cards',
  Posavasos: 'coasters',
  Taza: 'mugs',
};

export const PRICE_CENTS = {
  'greeting-cards': 349,
  coasters: 499,
  mugs: 999,
};

/** Image IDs after intra-product dedupe (first occurrence kept). */
export const PRODUCTS = [
  {
    legacyId: 2042,
    motif: 'Springer Spaniel',
    category: 'greeting-cards',
    imageIds: [2043, 2045, 2044],
    sourcePath: '/product/springer-spaniel-greeting-card-portrait/',
    title: {
      en: 'Springer Spaniel Greeting Card',
      es: 'Tarjeta de felicitación Springer Spaniel',
    },
    slug: {
      en: 'springer-spaniel-greeting-card',
      es: 'tarjeta-springer-spaniel',
    },
  },
  {
    legacyId: 1977,
    motif: 'Springer Spaniel',
    category: 'coasters',
    imageIds: [1978, 1979, 1980],
    sourcePath: '/product/springer-spaniel-coaster-portrait/',
    title: {
      en: 'Springer Spaniel Coaster',
      es: 'Posavasos Springer Spaniel',
    },
    slug: {
      en: 'springer-spaniel-coaster',
      es: 'posavasos-springer-spaniel',
    },
  },
  {
    legacyId: 1974,
    motif: 'Springer Spaniel',
    category: 'mugs',
    imageIds: [1975, 1976],
    sourcePath: '/product/springer-spaniel-black-mug-portrait/',
    title: {
      en: 'Springer Spaniel Mug',
      es: 'Taza Springer Spaniel',
    },
    slug: {
      en: 'springer-spaniel-mug',
      es: 'taza-springer-spaniel',
    },
  },
  {
    legacyId: 1968,
    motif: 'Labrador Retriever Black',
    category: 'greeting-cards',
    imageIds: [1970, 1971, 1969],
    sourcePath: '/product/labrador-retriever-black-greeting-card-portrait/',
    title: {
      en: 'Black Labrador Retriever Greeting Card',
      es: 'Tarjeta de felicitación Labrador Retriever negro',
    },
    slug: {
      en: 'black-labrador-greeting-card',
      es: 'tarjeta-labrador-negro',
    },
  },
  {
    legacyId: 1964,
    motif: 'Labrador Retriever Black',
    category: 'coasters',
    imageIds: [1965, 1966, 1967],
    sourcePath: '/product/labrador-retriever-black-coaster-portrait/',
    title: {
      en: 'Black Labrador Retriever Coaster',
      es: 'Posavasos Labrador Retriever negro',
    },
    slug: {
      en: 'black-labrador-coaster',
      es: 'posavasos-labrador-negro',
    },
  },
  {
    legacyId: 1961,
    motif: 'Labrador Retriever Black',
    category: 'mugs',
    imageIds: [1962, 1963],
    sourcePath: '/product/labrador-retriever-black-mug-portrait/',
    title: {
      en: 'Black Labrador Retriever Mug',
      es: 'Taza Labrador Retriever negro',
    },
    slug: {
      en: 'black-labrador-mug',
      es: 'taza-labrador-negro',
    },
  },
  {
    legacyId: 1957,
    motif: 'Golden Retriever',
    category: 'greeting-cards',
    imageIds: [1960, 1958, 1959],
    sourcePath: '/product/golden-retriever-greeting-card-portrait/',
    title: {
      en: 'Golden Retriever Greeting Card',
      es: 'Tarjeta de felicitación Golden Retriever',
    },
    slug: {
      en: 'golden-retriever-greeting-card',
      es: 'tarjeta-golden-retriever',
    },
  },
  {
    legacyId: 1953,
    motif: 'Golden Retriever',
    category: 'coasters',
    imageIds: [1954, 1955, 1956],
    sourcePath: '/product/golden-retriever-coaster-portrait/',
    title: {
      en: 'Golden Retriever Coaster',
      es: 'Posavasos Golden Retriever',
    },
    slug: {
      en: 'golden-retriever-coaster',
      es: 'posavasos-golden-retriever',
    },
  },
  {
    legacyId: 1950,
    motif: 'Golden Retriever',
    category: 'mugs',
    imageIds: [1951, 1952],
    sourcePath: '/product/golden-retriever-mug-portrait-copy/',
    title: {
      en: 'Golden Retriever Mug',
      es: 'Taza Golden Retriever',
    },
    slug: {
      en: 'golden-retriever-mug',
      es: 'taza-golden-retriever',
    },
  },
  {
    legacyId: 1944,
    motif: 'Dachshund',
    category: 'greeting-cards',
    imageIds: [1945, 1946, 1947],
    sourcePath: '/product/dachshund-greeting-card-portrait/',
    title: {
      en: 'Dachshund Greeting Card',
      es: 'Tarjeta de felicitación Teckel',
    },
    slug: {
      en: 'dachshund-greeting-card',
      es: 'tarjeta-teckel',
    },
  },
  {
    legacyId: 1940,
    motif: 'Dachshund',
    category: 'coasters',
    imageIds: [1942, 1941, 1943],
    sourcePath: '/product/dachshund-coaster-portrait/',
    title: {
      en: 'Dachshund Coaster',
      es: 'Posavasos Teckel',
    },
    slug: {
      en: 'dachshund-coaster',
      es: 'posavasos-teckel',
    },
  },
  {
    legacyId: 1937,
    motif: 'Dachshund',
    category: 'mugs',
    imageIds: [1938, 1939],
    sourcePath: '/product/dachshund-mug-portrait/',
    title: {
      en: 'Dachshund Mug',
      es: 'Taza Teckel',
    },
    slug: {
      en: 'dachshund-mug',
      es: 'taza-teckel',
    },
  },
  {
    legacyId: 1826,
    motif: 'Border Collie',
    category: 'greeting-cards',
    imageIds: [1827, 1828, 1829],
    sourcePath: '/product/border-collie-greeting-card-portrait/',
    title: {
      en: 'Border Collie Greeting Card',
      es: 'Tarjeta de felicitación Border Collie',
    },
    slug: {
      en: 'border-collie-greeting-card',
      es: 'tarjeta-border-collie',
    },
  },
  {
    legacyId: 1822,
    motif: 'Border Collie',
    category: 'coasters',
    imageIds: [1823, 1824, 1825],
    sourcePath: '/product/border-collie-coaster-portrait/',
    title: {
      en: 'Border Collie Coaster',
      es: 'Posavasos Border Collie',
    },
    slug: {
      en: 'border-collie-coaster',
      es: 'posavasos-border-collie',
    },
  },
  {
    legacyId: 1817,
    motif: 'Border Collie',
    category: 'mugs',
    imageIds: [1818, 1819],
    sourcePath: '/product/border-collie-mug-portrait-copy/',
    title: {
      en: 'Border Collie Mug',
      es: 'Taza Border Collie',
    },
    slug: {
      en: 'border-collie-mug',
      es: 'taza-border-collie',
    },
  },
  {
    legacyId: 1798,
    motif: 'Jack Russell Terrier',
    category: 'coasters',
    imageIds: [1799, 1800, 1801],
    sourcePath: '/product/jack-russell-terrier-coaster-portrait/',
    title: {
      en: 'Jack Russell Terrier Coaster',
      es: 'Posavasos Jack Russell Terrier',
    },
    slug: {
      en: 'jack-russell-coaster',
      es: 'posavasos-jack-russell',
    },
  },
  {
    legacyId: 1803,
    motif: 'Jack Russell Terrier',
    category: 'greeting-cards',
    imageIds: [1804, 1805],
    sourcePath: '/product/jack-russell-terrier-greeting-card-portrait/',
    title: {
      en: 'Jack Russell Terrier Greeting Card',
      es: 'Tarjeta de felicitación Jack Russell Terrier',
    },
    slug: {
      en: 'jack-russell-greeting-card',
      es: 'tarjeta-jack-russell',
    },
  },
  {
    legacyId: 1789,
    motif: 'Jack Russell Terrier',
    category: 'mugs',
    imageIds: [1790, 1791],
    sourcePath: '/product/jack-russell-terrier-mug-portrait/',
    title: {
      en: 'Jack Russell Terrier Mug',
      es: 'Taza Jack Russell Terrier',
    },
    slug: {
      en: 'jack-russell-mug',
      es: 'taza-jack-russell',
    },
  },
];

export const ASSET_HASHES = {
  1790: {
    file: 'Jack-russel.jpg',
    sha256: '1be829b5589e3fcad38847b190c0abfdd5315468734ecd6bcd6fac9c8dc32914',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/06/Jack-russel.jpg',
  },
  1791: {
    file: 'jack-russel-mug.jpg',
    sha256: '4c6571ead3a7fe9272dc4ecbe8afe3c964d119f40cef1ca6576278dfc76afc26',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/06/jack-russel-mug.jpg',
  },
  1799: {
    file: 'jack-russel-1.jpg',
    sha256: '3e18755cd607f30bb1624613f952f7d11ea8e69ee39fd5e97312f8aa4df79fa7',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/06/jack-russel-1.jpg',
  },
  1800: {
    file: 'jack-russel-3.jpg',
    sha256: '1932cde12232e147337cacffe7bd18c3f3ce7dcba52d81633093a3a033c406df',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/06/jack-russel-3.jpg',
  },
  1801: {
    file: 'Jack-russel_.jpg',
    sha256: '78284d0643fa99578c9b194f1a29941a850ebf088dacbde6557c554bbf2dcded',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/06/Jack-russel_.jpg',
  },
  1804: {
    file: 'Jackrusell-card.jpg',
    sha256: '1b67738600ed3d2d5045713f7053a989570f500f4f43f3e7e76732118f2b9a3c',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Jackrusell-card.jpg',
  },
  1805: {
    file: 'jackrussell-card-2.jpg',
    sha256: 'f3c218bdfe02afaa0470780298acff7ce47039912cd933b93d939ce0ed968917',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/jackrussell-card-2.jpg',
  },
  1818: {
    file: 'Border-Collie_.jpg',
    sha256: '9be73e2dbe2ea4666dec48358f4c60c70f57ff886223bc950943878722684a38',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Border-Collie_.jpg',
  },
  1819: {
    file: 'Border-Collie-mug.jpg',
    sha256: '93b2cecd8496536120304122b77abaf399da1feefb4075c4f3756978dc84f14c',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Border-Collie-mug.jpg',
  },
  1823: {
    file: 'Border-collie-1.jpg',
    sha256: '48df233b60d57add221351209e42005e40869d6961e0b218ec8287f54242ff0e',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Border-collie-1.jpg',
  },
  1824: {
    file: 'Border-collie-2.jpg',
    sha256: '0af1aa6c1f290ace50c5e6344e4abbef1ee6534724d66394ae0ec7129dabb6d7',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Border-collie-2.jpg',
  },
  1825: {
    file: 'Border-collie-3.jpg',
    sha256: '125e16d3c5fe514e28d1bec040108e0ddf9f85b6e1e79a82d44791c58ea14c57',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Border-collie-3.jpg',
  },
  1827: {
    file: 'White-Minimalist-Paper-Card-Mockup-Instagram-Post.png',
    sha256: 'bad0763fe8a292e33f5ce597ea8d6c37cd6a4a87d7f48a719f3efea6015ebb0a',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/White-Minimalist-Paper-Card-Mockup-Instagram-Post.png',
  },
  1828: {
    file: 'Neutral-Simple-Aesthetic-Wedding-Invitation-Card-Instagram-Post.png',
    sha256: '3e0451f9cc452379ae8625481f7a9f8a3eec430e0c6b84b6b2a770b494a1d110',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Neutral-Simple-Aesthetic-Wedding-Invitation-Card-Instagram-Post.png',
  },
  1829: {
    file: 'White-and-Beige-Minimalist-Card-Mockup-Facebook-Post.png',
    sha256: 'a81bb19d5ab86b4c64701be47821c4c66cdd7af28ec3d7debc1b599913686f69',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/White-and-Beige-Minimalist-Card-Mockup-Facebook-Post.png',
  },
  1938: {
    file: 'mock-up1-dashund.jpeg',
    sha256: 'be8f1ef534a65bf0e64720969d30bebe9797811e3ecfe640b7dfba9071b5e4b5',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/mock-up1-dashund.jpeg',
  },
  1939: {
    file: 'dachshund.jpg',
    sha256: 'c089c6894a0ac75ced994dfb478d191372f70eab8e0e80e5e3211d4c0eef4016',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/dachshund.jpg',
  },
  1941: {
    file: 'Dachshund-2.jpg',
    sha256: '5a766433fd1a9a84818e0919e87b74b788d6294f13925ba4dce7512892433d94',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Dachshund-2.jpg',
  },
  1942: {
    file: 'Dachshund-1.jpg',
    sha256: '93c1489ae9a5bed63dba0b3118f54478be6fb7537325568ba158898a6be30782',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Dachshund-1.jpg',
  },
  1943: {
    file: 'Dachshund-coaster.jpg',
    sha256: '044167e3319b40e76a33287b786ad7ada7cbe567496e208cc705d5d4766fc6e8',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Dachshund-coaster.jpg',
  },
  1945: {
    file: 'Neutral-Simple-Aesthetic-Wedding-Invitation-Card-Instagram-Post-1.png',
    sha256: '32c3e8abaf7b7fd0241765ff36c270fdc2ade027d4f98275c6941ca7013918e5',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Neutral-Simple-Aesthetic-Wedding-Invitation-Card-Instagram-Post-1.png',
  },
  1946: {
    file: 'White-and-Beige-Minimalist-Card-Mockup-Facebook-Post-5.png',
    sha256: 'a541a60067ce48c710352f79727adb8974ba040f6fc765a4a0baa955dd4d0816',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/White-and-Beige-Minimalist-Card-Mockup-Facebook-Post-5.png',
  },
  1947: {
    file: 'White-Minimalist-Paper-Card-Mockup-Instagram-Post-copy-2.png',
    sha256: 'f7c7f55aff9474579a0b56b330b744a7c543dd2f02ef40c38b89ec578a13e7e0',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/White-Minimalist-Paper-Card-Mockup-Instagram-Post-copy-2.png',
  },
  1951: {
    file: 'Golden-Retriver-1.jpg',
    sha256: 'ee48080f97b3e9cec91fb040a4b4a98e62564ccdd1dffcf7e8fc590ecd257341',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Golden-Retriver-1.jpg',
  },
  1952: {
    file: 'Golden-Retriver.jpg',
    sha256: 'fff97a1ec1e78bcad0478feadbfb0e676e17c951c6314926e46fb3813613daea',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Golden-Retriver.jpg',
  },
  1954: {
    file: 'Golden-Retriver-2.jpg',
    sha256: '0130faa554b0c7db3f8ccebae9826adbd306ae144c000799edf42a8e1bec8f7d',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Golden-Retriver-2.jpg',
  },
  1955: {
    file: 'Golden-Retriver-3.jpg',
    sha256: '1363cce991e96bd8ae4858de01f732dad7f4656273c8fb10722560e1164fd6a6',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Golden-Retriver-3.jpg',
  },
  1956: {
    file: 'Golden-Retriver-1-1.jpg',
    sha256: '6db15191c12a882550855ade45f27199f0f4952ca367beff9c9118c1ce0c57e3',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Golden-Retriver-1-1.jpg',
  },
  1958: {
    file: 'Neutral-Simple-Aesthetic-Wedding-Invitation-Card-Instagram-Post-copy.png',
    sha256: '255719ee84ab0f922c7e1886a607f6d9861104b2af3f5e0dc2f7ce43cd3d1f39',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Neutral-Simple-Aesthetic-Wedding-Invitation-Card-Instagram-Post-copy.png',
  },
  1959: {
    file: 'White-and-Beige-Minimalist-Card-Mockup-Facebook-Post-6.png',
    sha256: '2a6ff8c92515209c56e3c22cbac4aac441887a5d5d31452c49ea57d1c4277a17',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/White-and-Beige-Minimalist-Card-Mockup-Facebook-Post-6.png',
  },
  1960: {
    file: 'White-Minimalist-Paper-Card-Mockup-Instagram-Post-4.png',
    sha256: 'f0182c03753f89807019061448dfb6b27f7329a2aed714db8e3f86e4516a2f7e',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/White-Minimalist-Paper-Card-Mockup-Instagram-Post-4.png',
  },
  1962: {
    file: 'mockupod_0101_white-11oz-coffee-mug-mockup-aesthetic-background-2.jpg',
    sha256: '7897fcc5b41ea79578c56c92483c06a6085efe82336be3c99bbd660f3f38249c',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/mockupod_0101_white-11oz-coffee-mug-mockup-aesthetic-background-2.jpg',
  },
  1963: {
    file: 'Labrador.jpg',
    sha256: 'b45471a30f12e51b66fd49aa92e8a003a580390c15138da102079aff15b3e138',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Labrador.jpg',
  },
  1965: {
    file: 'Coaster-Labrador.jpg',
    sha256: '2fe4deeccf53cb86dfce1888cc3cf8a02b14fb80e28def57a2bed59d884d5aee',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Coaster-Labrador.jpg',
  },
  1966: {
    file: 'Labrador-1.jpg',
    sha256: '7f68ace4927da26262d822e6fb235ef1e1d66a12698c7a30ca15b43b919d516e',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Labrador-1.jpg',
  },
  1967: {
    file: 'Labrador-2.jpg',
    sha256: 'a17951426205f4839d53bdadfea8c6d3c1a9023316c7405788c2792059cdd14a',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Labrador-2.jpg',
  },
  1969: {
    file: 'White-and-Beige-Minimalist-Card-Mockup-Facebook-Post-2.png',
    sha256: 'bb70459131425769aa96e3d6c0f69a349c6c86f5f132fd921a7285ac48e7be44',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/White-and-Beige-Minimalist-Card-Mockup-Facebook-Post-2.png',
  },
  1970: {
    file: 'White-Minimalist-Paper-Card-Mockup-Instagram-Post-copy-3.png',
    sha256: 'df65ae56c08fbf29d37bb161636e1f52f1d8c2d59c0d48bab16f4f85fc0b2187',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/White-Minimalist-Paper-Card-Mockup-Instagram-Post-copy-3.png',
  },
  1971: {
    file: 'Neutral-Simple-Aesthetic-Wedding-Invitation-Card-Instagram-Post-2.jpg',
    sha256: '493106082e754620fbfcd740d3a73969c12544ebffe7a7bb2df8dd2b59c9860a',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Neutral-Simple-Aesthetic-Wedding-Invitation-Card-Instagram-Post-2.jpg',
  },
  1975: {
    file: 'Unknown.jpeg',
    sha256: '2d43bf2c94fc7d546fb410f956439a670e8c17b3915f50097ce01648f1380c10',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Unknown.jpeg',
  },
  1976: {
    file: 'Sringer-spanial.jpg',
    sha256: '21d539773d07a57c95ae8f11cf5f6410e875c9f467cc26285a47b98d78d1bc8c',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Sringer-spanial.jpg',
  },
  1978: {
    file: 'Coaster-Springer-spanials.jpg',
    sha256: '620ac86d2624c76fb322f821ff4662be3e82f937756df6832db6af6475de5c2b',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Coaster-Springer-spanials.jpg',
  },
  1979: {
    file: 'Springer-spanial-1.jpg',
    sha256: '4bd1e0799a5b941df78be81b770781368fb733418829f9669e8d25a534e80bd8',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/Springer-spanial-1.jpg',
  },
  1980: {
    file: 'springer-spanial-2.jpg',
    sha256: '34a7746f005fb9638b46c35ad0e2b4313c979e7cf426fa1954dcfd0a4e82718f',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/07/springer-spanial-2.jpg',
  },
  2043: {
    file: 'White-Minimalist-Paper-Card-Mockup-Instagram-Post-2.png',
    sha256: 'f2744bf170c174e50e74f7e7cfdb47b352e9b834e65d86d2cf85b0ac4b0aa852',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/08/White-Minimalist-Paper-Card-Mockup-Instagram-Post-2.png',
  },
  2044: {
    file: 'Neutral-Simple-Aesthetic-Wedding-Invitation-Card-Instagram-Post.jpg',
    sha256: '2d8253e49ef50d9665f1a929f3cff2c52c9a20a088b6b228d796bf215287ccd4',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/08/Neutral-Simple-Aesthetic-Wedding-Invitation-Card-Instagram-Post.jpg',
  },
  2045: {
    file: 'White-and-Beige-Minimalist-Card-Mockup-Facebook-Post-4.png',
    sha256: '402c91fe331fc428939f52a227a5601b5a493a8d200b8d07255b4e789238141f',
    url: 'https://petsdrawings.com/wp-content/uploads/2026/08/White-and-Beige-Minimalist-Card-Mockup-Facebook-Post-4.png',
  },
};
