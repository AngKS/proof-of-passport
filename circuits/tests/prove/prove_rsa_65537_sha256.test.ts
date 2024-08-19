import { describe } from 'mocha';
import { assert, expect } from 'chai';
import path from 'path';
const wasm_tester = require('circom_tester').wasm;
import { poseidon1, poseidon6 } from 'poseidon-lite';
import { mockPassportData_sha256_rsa_65537 } from '../../../common/src/constants/mockPassportData';
import {
  generateCircuitInputsRegister,
  generateCircuitInputsProve,
} from '../../../common/src/utils/generateInputs';
import { getLeaf } from '../../../common/src/utils/pubkeyTree';
import { packBytes } from '../../../common/src/utils/utils';
import { computeLeafFromModulusBigInt } from '../../../common/src/utils/csca';

describe('PROVE - RSA SHA256', function () {
  this.timeout(0);
  let inputs: any;
  let circuit: any;
  let passportData = mockPassportData_sha256_rsa_65537;
  let attestation_id: string;
  const attestation_name = 'E-PASSPORT';
  const n_dsc = 121;
  const k_dsc = 17;
  const majority = '18';
  const user_identifier = '0xE6E4b6a802F2e0aeE5676f6010e0AF5C9CDd0a50';
  const scope = poseidon1([BigInt(Buffer.from('VOTEEEEE').readUIntBE(0, 6))]).toString();

  before(async () => {
    circuit = await wasm_tester(
      path.join(__dirname, '../../circuits/prove/prove_rsa_65537_sha256.circom'),
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
    const bitmap = Array(90).fill('1');
    inputs = generateCircuitInputsProve(
      passportData,
      n_dsc,
      k_dsc,
      scope,
      bitmap,
      majority,
      user_identifier
    );
  });

  it('should compile and load the circuit', async function () {
    expect(circuit).to.not.be.undefined;
  });

  it('should calculate the witness with correct inputs', async function () {
    const w = await circuit.calculateWitness(inputs);
    await circuit.checkConstraints(w);

    const nullifier = (await circuit.getOutput(w, ['nullifier'])).nullifier;
    expect(nullifier).to.be.not.null;
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

  it('should fail to calculate witness with invalid dataHashes', async function () {
    try {
      const invalidInputs = {
        ...inputs,
        dataHashes: inputs.dataHashes.map((byte: string) => String((parseInt(byte, 10) + 1) % 256)),
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
