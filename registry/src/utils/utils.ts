import * as asn1 from 'asn1js';
import { getNamedCurve, identifyCurve, StandardCurve } from './curves';
import * as fs from 'fs';
import * as path from 'path';
import { Certificate } from 'pkijs';
import { fromBER, BitString } from 'asn1js';
import * as forge from 'node-forge';
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export function getSignatureAlgorithmDetails(oid: string): { signatureAlgorithm: string, hashFunction: string } {
    const details = {
        '1.2.840.113549.1.1.5': { signatureAlgorithm: 'RSA', hashFunction: 'SHA-1' },
        '1.2.840.113549.1.1.11': { signatureAlgorithm: 'RSA', hashFunction: 'SHA-256' },
        '1.2.840.113549.1.1.12': { signatureAlgorithm: 'RSA', hashFunction: 'SHA-384' },
        '1.2.840.113549.1.1.13': { signatureAlgorithm: 'RSA', hashFunction: 'SHA-512' },
        // rsapss
        '1.2.840.113549.1.1.10': { signatureAlgorithm: 'RSA-PSS', hashFunction: 'Variable' },
        // ecdsa
        '1.2.840.10045.4.1': { signatureAlgorithm: 'ECDSA', hashFunction: 'SHA-1' },
        '1.2.840.10045.4.3.1': { signatureAlgorithm: 'ECDSA', hashFunction: 'SHA-224' },
        '1.2.840.10045.4.3.2': { signatureAlgorithm: 'ECDSA', hashFunction: 'SHA-256' },
        '1.2.840.10045.4.3.3': { signatureAlgorithm: 'ECDSA', hashFunction: 'SHA-384' },
        '1.2.840.10045.4.3.4': { signatureAlgorithm: 'ECDSA', hashFunction: 'SHA-512' },
    };
    return details[oid] || { signatureAlgorithm: `Unknown (${oid})`, hashFunction: 'Unknown' };
}

export function getHashAlgorithmName(oid: string): string {
    const hashAlgorithms = {
        '1.3.14.3.2.26': 'SHA-1',
        '2.16.840.1.101.3.4.2.1': 'SHA-256',
        '2.16.840.1.101.3.4.2.2': 'SHA-384',
        '2.16.840.1.101.3.4.2.3': 'SHA-512',
    };
    return hashAlgorithms[oid] || `Unknown (${oid})`;
}

export function parseRsaPssParams(params: any): string {
    try {
        const algorithmParams = asn1.fromBER(params.valueBeforeDecodeView);
        const hashAlgorithm = (algorithmParams.result.valueBlock as any).value[0];
        const hashAlgorithmSequence = hashAlgorithm.valueBlock.value[0];
        const hashAlgorithmOid = hashAlgorithmSequence.valueBlock.value[0].valueBlock.toString();
        return getHashAlgorithmName(hashAlgorithmOid);
    } catch (error) {
        console.error('Error parsing RSA-PSS parameters:', error);
        return 'Unknown';
    }
}

export function parseECParameters(publicKeyInfo: any): PublicKeyDetailsECDSA {
    try {
        const algorithmParams = publicKeyInfo.algorithm.algorithmParams;
        if (!algorithmParams) {
            console.log('No algorithm params found');
            return { curve: 'Unknown', params: {} as StandardCurve };
        }

        const params = asn1.fromBER(algorithmParams.valueBeforeDecodeView).result;
        const valueBlock: any = params.valueBlock;

        if (valueBlock.value && valueBlock.value.length >= 6) {
            const curveParams: StandardCurve = {} as StandardCurve;

            const fieldId = valueBlock.value[1];
            if (fieldId && fieldId.valueBlock && fieldId.valueBlock.value) {
                const fieldType = fieldId.valueBlock.value[0];
                const prime = fieldId.valueBlock.value[1];
                curveParams.p = Buffer.from(prime.valueBlock.valueHexView).toString('hex');
            }

            const curveCoefficients = valueBlock.value[2];
            if (curveCoefficients && curveCoefficients.valueBlock && curveCoefficients.valueBlock.value) {
                const a = curveCoefficients.valueBlock.value[0];
                const b = curveCoefficients.valueBlock.value[1];
                curveParams.a = Buffer.from(a.valueBlock.valueHexView).toString('hex');
                curveParams.b = Buffer.from(b.valueBlock.valueHexView).toString('hex');
            }

            const basePoint = valueBlock.value[3];
            if (basePoint && basePoint.valueBlock) {
                curveParams.G = Buffer.from(basePoint.valueBlock.valueHexView).toString('hex');
            }

            const order = valueBlock.value[4];
            if (order && order.valueBlock) {
                curveParams.n = Buffer.from(order.valueBlock.valueHexView).toString('hex');
            }

            const cofactor = valueBlock.value[5];
            if (cofactor && cofactor.valueBlock) {
                curveParams.h = Buffer.from(cofactor.valueBlock.valueHexView).toString('hex');
            }

            const identifiedCurve = identifyCurve(curveParams);
            return { curve: identifiedCurve, params: curveParams };
        } else {
            if (valueBlock.value) {
                console.log('value block length:', valueBlock.value.length);
                if (algorithmParams.idBlock.tagNumber === 6) {
                    const curveOid = algorithmParams.valueBlock.toString();
                    const curveName = getNamedCurve(curveOid);
                    return { curve: curveName, params: {} as StandardCurve };
                }
            } else {
                console.log('value block is not defined');
            }
            return { curve: 'Unknown', params: {} as StandardCurve };
        }
    } catch (error) {
        console.error('Error parsing EC parameters:', error);
        return { curve: 'Error', params: {} as StandardCurve };
    }
}

export interface CertificateData {
    id: string;
    issuer: string;
    validity: {
        notBefore: string;
        notAfter: string;
    };
    subjectKeyIdentifier: string;
    signatureAlgorithm: string;
    hashAlgorithm: string;
    publicKeyDetails: PublicKeyDetailsRSA | PublicKeyDetailsECDSA | undefined;
    rawPem: string;
    rawTxt: string;
}

export interface PublicKeyDetailsRSA {
    modulus: string;
    exponent: string;
}

export interface PublicKeyDetailsECDSA {
    curve: string;
    params: StandardCurve;
}

export async function processCertificate(pemContent: string, fileName: string): Promise<CertificateData | null> {
    let certificateData: CertificateData = {
        id: '',
        issuer: '',
        validity: {
            notBefore: '',
            notAfter: ''
        },
        subjectKeyIdentifier: '',
        signatureAlgorithm: '',
        hashAlgorithm: '',
        publicKeyDetails: undefined,
        rawPem: '',
        rawTxt: ''
    };

    try {
        const certBuffer = Buffer.from(pemContent.replace(/(-----(BEGIN|END) CERTIFICATE-----|\n)/g, ''), 'base64');
        const asn1Data = asn1.fromBER(certBuffer);
        const cert = new Certificate({ schema: asn1Data.result });

        const subjectKeyIdentifier = cert.extensions.find(
            (ext) => ext.extnID === '2.5.29.14' // OID for Subject Key Identifier
        );
        const subjectPublicKeyInfo = cert.subjectPublicKeyInfo;
        const signatureAlgorithmOid = cert.signatureAlgorithm.algorithmId;
        const { signatureAlgorithm, hashFunction } = getSignatureAlgorithmDetails(signatureAlgorithmOid);
        certificateData.signatureAlgorithm = signatureAlgorithm;
        certificateData.hashAlgorithm = hashFunction;

        // Extract issuer information
        const issuerRDN = cert.issuer.typesAndValues;
        let issuerCountryCode = '';
        for (const rdn of issuerRDN) {
            if (rdn.type === '2.5.4.6') { // OID for Country Name
                issuerCountryCode = rdn.value.valueBlock.value;
                break;
            }
        }
        certificateData.issuer = issuerCountryCode.toUpperCase();

        // Extract validity period
        certificateData.validity = {
            notBefore: cert.notBefore.value.toString(),
            notAfter: cert.notAfter.value.toString()
        };

        // Extract Subject Key Identifier
        if (subjectKeyIdentifier) {
            certificateData.subjectKeyIdentifier = Buffer.from(subjectKeyIdentifier.extnValue.valueBlock.valueHex).toString('hex');
        }

        if (signatureAlgorithm === 'RSA') {
            const publicKey = subjectPublicKeyInfo.subjectPublicKey;
            const asn1PublicKey = asn1.fromBER(publicKey.valueBlock.valueHexView);
            const rsaPublicKey = asn1PublicKey.result.valueBlock;

            if (rsaPublicKey && (rsaPublicKey as any).value && (rsaPublicKey as any).value[0] && (rsaPublicKey as any).value[1]) {
                const modulusAsn1 = (rsaPublicKey as any).value[0];
                const exponentAsn1 = (rsaPublicKey as any).value[1];
                const modulusHex = Buffer.from(modulusAsn1.valueBlock.valueHexView).toString('hex');
                const exponentHex = Buffer.from(exponentAsn1.valueBlock.valueHexView).toString('hex');

                const publicKeyForge = forge.pki.rsa.setPublicKey(
                    new forge.jsbn.BigInteger(modulusHex, 16),
                    new forge.jsbn.BigInteger(exponentHex, 16)
                );
                const PublicKeyDetailsRSA: PublicKeyDetailsRSA = {
                    modulus: publicKeyForge.n.toString(16),
                    exponent: publicKeyForge.e.toString(10)
                };
                certificateData.publicKeyDetails = PublicKeyDetailsRSA;
            }
            else {
                console.log('\x1b[90mRSA public key not found, probably ECDSA certificate\x1b[0m');
            }
        }
        if (signatureAlgorithm === 'RSA-PSS') {
            const rsaPssParams = cert.signatureAlgorithm.algorithmParams;
            if (rsaPssParams) {
                const hashAlgorithm = parseRsaPssParams(rsaPssParams);
                certificateData.hashAlgorithm = hashAlgorithm;
            }
        }

        if (signatureAlgorithm === 'ECDSA') {
            try {
                const publicKeyInfo = cert.subjectPublicKeyInfo;
                const publicKeyDetailsECDSA = parseECParameters(publicKeyInfo);
                certificateData.publicKeyDetails = publicKeyDetailsECDSA;
            } catch (error) {
                console.error('Error processing ECDSA certificate:', error);
            }
        }

        if (subjectKeyIdentifier) {
            certificateData.subjectKeyIdentifier = Buffer.from(subjectKeyIdentifier.extnValue.valueBlock.valueHexView).toString('hex');
            certificateData.id = certificateData.subjectKeyIdentifier.slice(0, 8);
        } else {
            console.log('Subject Key Identifier not found');
        }

        function getTempCertPath(fileName) {
            const tmpDir = oss.tmpdir(); // Dir from OS
            return pathh.join(tmpDir, fileName); // Join temp dir + filename
        }
        certificateData.rawPem = pemContent;
        //To solve error from tmp dir
        const fss = require('fs');
        const oss = require('os');
        const pathh = require('path');
        const { execSync } = require('child_process');
        const tempCertPath = getTempCertPath(fileName);
        fss.writeFileSync(tempCertPath, pemContent);
        try {
            const openSslOutput = execSync(`openssl x509 -in ${tempCertPath} -text -noout`).toString();
            certificateData.rawTxt = openSslOutput;
        } catch (error) {
            console.error(`Error executing OpenSSL command: ${error}`);
            certificateData.rawTxt = 'Error: Unable to generate human-readable format';
        } finally {
            fss.unlinkSync(tempCertPath);
        }
        return certificateData;
    } catch (error) {
        console.error(`Error processing ${fileName}:`, error);
        return null;
    }
}

function publicKeyDetailsToJson(details: PublicKeyDetailsRSA | PublicKeyDetailsECDSA | undefined): any {
    if (!details) return null;
    if ('modulus' in details) {
        return {
            type: 'RSA',
            modulus: details.modulus,
            exponent: details.exponent,
        };
    } else {
        return {
            type: 'ECDSA',
            curve: details.curve,
            params: details.params,
        };
    }
}

export async function insertDB(certificateData: CertificateData) {
    try {
        const result = await prisma.certificatesjs.upsert({
            where: { id: certificateData.id },
            update: {},
            create: {
                id: certificateData.id,
                issuer: certificateData.issuer,
                hashAlgorithm: certificateData.hashAlgorithm,
                signatureAlgorithm: certificateData.signatureAlgorithm,
                validity: certificateData.validity,
                subjectKeyIdentifier: certificateData.subjectKeyIdentifier,
                publicKeyDetails: publicKeyDetailsToJson(certificateData.publicKeyDetails),
                rawPem: certificateData.rawPem,
                rawTxt: certificateData.rawTxt,
            },
        })
        return result;
    } catch (error) {
        console.error(`Error processing insert to db`, error);
        throw error;
    }
}