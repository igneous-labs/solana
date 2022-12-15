import { Connection } from "@solana/web3.js";

export default async function handler(request, response) {
  const { connection: connectionUrl, block: blockId } = request.body;
  let connection = new Connection(connectionUrl);
  var block = await connection.getBlock(blockId, {
    maxSupportedTransactionVersion: 0,
  });

  // Serialize transaction messages
  for (let tx of block.transactions) {
    tx.transaction.message = Array.from(
      Uint8Array.from(tx.transaction.message.serialize())
    );
  }
  // Cache block response for up to 10 days in Vercel Edge, without caching in browser
  response.setHeader("Cache-Control", "max-age=0,s-maxage=864000");
  response.status(200).json(block);
}
