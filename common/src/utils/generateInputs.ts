import { MAX_DATAHASHES_LEN, SignatureAlgorithm, PUBKEY_TREE_DEPTH } from "../constants/constants";
import { assert, shaPad } from "./shaPad";
import { PassportData } from "./types";
import {
  arraysAreEqual, bytesToBigDecimal, formatMrz, formatSigAlg, hash, splitToWords,
  toUnsignedByte, getDigestLengthBytes, getCurrentDateYYMMDD
} from "./utils";
import { IMT } from "@zk-kit/imt";
import { getLeaf } from "./pubkeyTree";
import serializedTree from "../../pubkeys/serialized_tree.json";
import { poseidon2, poseidon6 } from "poseidon-lite";
import { packBytes } from "../utils/utils";

export function generateCircuitInputsRegister(
  secret: string,
  attestation_id: string,
  passportData: PassportData,
  options: { developmentMode?: boolean } = { developmentMode: false }
) {
  const tree = new IMT(poseidon2, PUBKEY_TREE_DEPTH, 0, 2);
  tree.setNodes(serializedTree);

  if (options.developmentMode) {
    tree.insert(getLeaf({
      signatureAlgorithm: passportData.signatureAlgorithm,
      issuer: 'C = TS, O = Government of Syldavia, OU = Ministry of tests, CN = CSCA-TEST',
      modulus: passportData.pubKey.modulus,
      exponent: passportData.pubKey.exponent
    }).toString());
  }

  if (!["sha256WithRSAEncryption", "sha1WithRSAEncryption"].includes(passportData.signatureAlgorithm)) {
    console.error(`${passportData.signatureAlgorithm} not supported for proof right now.`);
    throw new Error(`${passportData.signatureAlgorithm} not supported for proof right now.`);
  }

  const formattedMrz = formatMrz(passportData.mrz);
  const concatenatedDataHashesHashDigest = hash(passportData.signatureAlgorithm, passportData.dataGroupHashes);
  // console.log('concatenatedDataHashesHashDigest', concatenatedDataHashesHashDigest);

  assert(
    arraysAreEqual(passportData.eContent.slice(72, 72 + getDigestLengthBytes(passportData.signatureAlgorithm)),
      concatenatedDataHashesHashDigest),
    'concatenatedDataHashesHashDigest is at the right place in passportData.eContent'
  );

  // console.log('passportData.pubKey.exponent', passportData.pubKey.exponent);

  const leaf = getLeaf({
    signatureAlgorithm: passportData.signatureAlgorithm,
    ...passportData.pubKey,
  }).toString();
  // console.log('leaf', leaf);

  const index = tree.indexOf(leaf);
  // console.log(`Index of pubkey in the registry: ${index}`);
  if (index === -1) {
    throw new Error("Your public key was not found in the registry");
  }

  const proof = tree.createProof(index);
  // console.log("verifyProof", tree.verifyProof(proof));

  if (passportData.dataGroupHashes.length > MAX_DATAHASHES_LEN) {
    console.error(`Data hashes too long. Max length is ${MAX_DATAHASHES_LEN} bytes.`);
    throw new Error(`This number of datagroups is currently unsupported. Please contact us so we add support!`);
  }

  const [messagePadded, messagePaddedLen] = shaPad(
    passportData.signatureAlgorithm,
    new Uint8Array(passportData.dataGroupHashes),
    MAX_DATAHASHES_LEN
  );

  const sigAlgFormatted = formatSigAlg(passportData.signatureAlgorithm, passportData.pubKey.exponent);
  const sigAlgIndex = SignatureAlgorithm[sigAlgFormatted]

  return {
    secret: [secret],
    mrz: formattedMrz.map(byte => String(byte)),
    econtent: Array.from(messagePadded).map((x) => x.toString()),
    datahashes_padded_length: [messagePaddedLen.toString()],
    signed_attributes: passportData.eContent.map(toUnsignedByte).map(byte => String(byte)),
    signature: splitToWords(
      BigInt(bytesToBigDecimal(passportData.encryptedDigest)),
      BigInt(64),
      BigInt(32)
    ),
    pubkey: splitToWords(
      BigInt(passportData.pubKey.modulus as string),
      BigInt(64),
      BigInt(32)
    ),
    merkle_root: [tree.root.toString()],
    path: proof.pathIndices.map(index => index.toString()),
    siblings: proof.siblings.flat().map(index => index.toString()),
    attestation_id: [attestation_id],
  };
}

export function generateCircuitInputsDisclose(
  secret: string,
  attestation_id: string,
  passportData: PassportData,
  merkletree: IMT,
  majority: string[],
  bitmap: string[],
  scope: string,
  user_identifier: string
) {
  const pubkey_leaf = getLeaf({
    signatureAlgorithm: passportData.signatureAlgorithm,
    modulus: passportData.pubKey.modulus,
    exponent: passportData.pubKey.exponent,
  });

  const formattedMrz = formatMrz(passportData.mrz);
  const mrz_bytes = packBytes(formattedMrz);
  const commitment = poseidon6([
    secret,
    attestation_id,
    pubkey_leaf,
    mrz_bytes[0],
    mrz_bytes[1],
    mrz_bytes[2]
  ]).toString();
  console.log("commitment", commitment);

  const index = merkletree.indexOf(BigInt(commitment));
  console.log(`Index of commitment in the tree: ${index}`);
  if (index === -1) {
    throw new Error("This commitment was not found in the tree");
  }
  const proof = merkletree.createProof(index);
  console.log("verifyProof", merkletree.verifyProof(proof));

  return {
    secret: secret,
    attestation_id: attestation_id,
    pubkey_leaf: pubkey_leaf.toString(),
    mrz: formattedMrz.map(byte => String(byte)),
    merkle_root: [merkletree.root.toString()],
    merkletree_size: BigInt(proof.pathIndices.length).toString(),
    path: proof.pathIndices.map(index => index.toString()),
    siblings: proof.siblings.flat().map(index => index.toString()),
    bitmap: bitmap,
    scope: scope,
    current_date: getCurrentDateYYMMDD().map(datePart => BigInt(datePart).toString()),
    majority: majority.map(char => BigInt(char.charCodeAt(0)).toString()),
    user_identifier: user_identifier,
  };
}