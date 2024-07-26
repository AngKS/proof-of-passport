import { describe } from 'mocha';
import { assert, expect } from 'chai';
import path from 'path';
const wasm_tester = require('circom_tester').wasm;
import { poseidon1, poseidon6 } from 'poseidon-lite';
import { mockPassportData_sha256_rsa_65537 } from '../../../common/src/constants/mockPassportData';
import { generateCircuitInputsRegister } from '../../../common/src/utils/generateInputs';
import { getLeaf } from '../../../common/src/utils/pubkeyTree';
import { packBytes } from '../../../common/src/utils/utils';
import { computeLeafFromModulusBigInt } from '../../../common/src/utils/csca';

describe('Register - SHA256 RSA', function () {
  this.timeout(0);
  let inputs: any;
  let circuit: any;
  let passportData = mockPassportData_sha256_rsa_65537;
  let attestation_id: string;
  const attestation_name = 'E-PASSPORT';
  const n_dsc = 121;
  const k_dsc = 17;

  before(async () => {
    circuit = await wasm_tester(
      path.join(__dirname, '../../circuits/register/register_sha256WithRSAEncryption_65537.circom'),
      {
        include: [
          'node_modules',
          './node_modules/@zk-kit/binary-merkle-root.circom/src',
          './node_modules/circomlib/circuits',
        ],
      }
    );

    const secret = BigInt(Math.floor(Math.random() * Math.pow(2, 254))).toString();
    const dscSecret = BigInt(Math.floor(Math.random() * Math.pow(2, 254))).toString();
    attestation_id = poseidon1([BigInt(Buffer.from(attestation_name).readUIntBE(0, 6))]).toString();
    inputs = generateCircuitInputsRegister(
      secret,
      dscSecret,
      attestation_id,
      passportData,
      n_dsc,
      k_dsc
    );
  });

  it('should compile and load the circuit', async function () {
    expect(circuit).to.not.be.undefined;
  });

  it('should calculate the witness with correct inputs', async function () {
    const w = await circuit.calculateWitness(inputs);
    await circuit.checkConstraints(w);

    const nullifier = (await circuit.getOutput(w, ['nullifier'])).nullifier;
    console.log('\x1b[34m%s\x1b[0m', 'nullifier', nullifier);
    const commitment_circom = (await circuit.getOutput(w, ['commitment'])).commitment;
    console.log('\x1b[34m%s\x1b[0m', 'commitment', commitment_circom);
    const blinded_dsc_commitment = (await circuit.getOutput(w, ['blinded_dsc_commitment']))
      .blinded_dsc_commitment;
    console.log('\x1b[34m%s\x1b[0m', 'blinded_dsc_commitment', blinded_dsc_commitment);

    const mrz_bytes = packBytes(inputs.mrz);
    const commitment_bytes = poseidon6([
      inputs.secret[0],
      attestation_id,
      computeLeafFromModulusBigInt(BigInt(passportData.pubKey.modulus)),
      mrz_bytes[0],
      mrz_bytes[1],
      mrz_bytes[2],
    ]);
    const commitment_js = commitment_bytes.toString();
    //console.log('commitment_js', commitment_js)
    //console.log('commitment_circom', commitment_circom)
    expect(commitment_circom).to.be.equal(commitment_js);
  });

  it('should fail to calculate witness with invalid mrz', async function () {
    try {
      const invalidInputs = {
        ...inputs,
        mrz: Array(93)
          .fill(0)
          .map((byte) => BigInt(byte).toString()),
      };
      await circuit.calculateWitness(invalidInputs);
      expect.fail('Expected an error but none was thrown.');
    } catch (error) {
      expect(error.message).to.include('Assert Failed');
    }
  });

  it('should fail to calculate witness with invalid econtent', async function () {
    try {
      const invalidInputs = {
        ...inputs,
        econtent: inputs.econtent.map((byte: string) => String((parseInt(byte, 10) + 1) % 256)),
      };
      await circuit.calculateWitness(invalidInputs);
      expect.fail('Expected an error but none was thrown.');
    } catch (error) {
      expect(error.message).to.include('Assert Failed');
    }
  });

  it('should fail to calculate witness with invalid signature', async function () {
    try {
      const invalidInputs = {
        ...inputs,
        signature: inputs.signature.map((byte: string) => String((parseInt(byte, 10) + 1) % 256)),
      };
      await circuit.calculateWitness(invalidInputs);
      expect.fail('Expected an error but none was thrown.');
    } catch (error) {
      expect(error.message).to.include('Assert Failed');
    }
  });
});
