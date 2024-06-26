// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import {Groth16Verifier} from "./Verifier.sol";
import {Base64} from "./libraries/Base64.sol";
import {Formatter} from "./Formatter.sol";
import {Registry} from "./Registry.sol";
import "hardhat/console.sol";

contract ProofOfPassport is ERC721Enumerable, Ownable {
    using Strings for uint256;
    using Base64 for *;

    Groth16Verifier public immutable verifier;
    Formatter public formatter;
    Registry public registry;

    mapping(uint256 => bool) public nullifiers;

    struct AttributePosition {
        string name;
        uint256 start;
        uint256 end;
        uint256 index;
    }

    struct Attributes {
        string[8] values;
    }

    AttributePosition[] public attributePositions;

    mapping(uint256 => Attributes) private tokenAttributes;

    constructor(
        Groth16Verifier v,
        Formatter f,
        Registry r
    ) ERC721("ProofOfPassport", "ProofOfPassport") {
        verifier = v;
        formatter = f;
        registry = r;
        setupAttributes();
        transferOwnership(msg.sender);
    }

    function setupAttributes() internal {
        attributePositions.push(AttributePosition("issuing_state", 2, 4, 0));
        attributePositions.push(AttributePosition("name", 5, 43, 1));
        attributePositions.push(
            AttributePosition("passport_number", 44, 52, 2)
        );
        attributePositions.push(AttributePosition("nationality", 54, 56, 3));
        attributePositions.push(AttributePosition("date_of_birth", 57, 62, 4));
        attributePositions.push(AttributePosition("gender", 64, 64, 5));
        attributePositions.push(AttributePosition("expiry_date", 65, 70, 6));
        attributePositions.push(AttributePosition("older_than", 88, 89, 7));
    }

    function mint(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[12] memory inputs
    ) public {
        require(verifier.verifyProof(a, b, c, inputs), "Invalid Proof");

        // check that the nullifier has not been used before
        // require(!nullifiers[inputs[3]], "Signature already nullified");

        require(registry.checkRoot(bytes32(inputs[4])), "Invalid merkle root");

        // require that the current date is valid
        // Convert the last four parameters into a valid timestamp, adding 30 years to adjust for block.timestamp starting in 1970
        uint[6] memory dateNum;
        for (uint i = 0; i < 6; i++) {
            dateNum[i] = inputs[6 + i];
        }
        uint currentTimestamp = getCurrentTimestamp(dateNum);

        // Check that the current date is within a +/- 1 day range
        require(
            currentTimestamp >= block.timestamp - 1 days  && currentTimestamp <= block.timestamp + 1 days,
            "Current date is not within the valid range"
        );


        // Effects: Mint token
        address addr = address(uint160(inputs[5])); // address is the 5th input
        uint256 newTokenId = totalSupply();
        _mint(addr, newTokenId);
        nullifiers[inputs[3]] = true;

        // Set attributes
        uint256[3] memory firstThree = sliceFirstThree(inputs);
        bytes memory charcodes = fieldElementsToBytes(firstThree);
        // console.logBytes1(charcodes[21]);

        Attributes storage attributes = tokenAttributes[newTokenId];

        for (uint i = 0; i < attributePositions.length; i++) {
            AttributePosition memory attribute = attributePositions[i];
            bytes memory attributeBytes = new bytes(
                attribute.end - attribute.start + 1
            );
            for (uint j = attribute.start; j <= attribute.end; j++) {
                attributeBytes[j - attribute.start] = charcodes[j];
            }
            string memory attributeValue = string(attributeBytes);
            attributes.values[i] = attributeValue;
            console.log(attribute.name, attributes.values[i]);
        }
    }

    function fieldElementsToBytes(
        uint256[3] memory publicSignals
    ) public pure returns (bytes memory) {
        uint8[3] memory bytesCount = [31, 31, 28];
        bytes memory bytesArray = new bytes(90); // 31 + 31 + 28

        uint256 index = 0;
        for (uint256 i = 0; i < 3; i++) {
            uint256 element = publicSignals[i];
            for (uint8 j = 0; j < bytesCount[i]; j++) {
                bytesArray[index++] = bytes1(uint8(element & 0xFF));
                element = element >> 8;
            }
        }

        return bytesArray;
    }

    function sliceFirstThree(
        uint256[12] memory input
    ) public pure returns (uint256[3] memory) {
        uint256[3] memory sliced;

        for (uint256 i = 0; i < 3; i++) {
            sliced[i] = input[i];
        }

        return sliced;
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal virtual override {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
        require(
            from == address(0),
            "Cannot transfer - Proof of Passport is soulbound"
        );
    }

    function tokenURI(
        uint256 _tokenId
    ) public view virtual override returns (string memory) {
        require(
            _exists(_tokenId),
            "ERC721Metadata: URI query for nonexistent token"
        );
        Attributes memory attributes = tokenAttributes[_tokenId];

        console.log("Issuing state in tokenURI", attributes.values[0]);

        string memory firstName;
        string memory lastName;

        (firstName, lastName) = formatter.formatName(attributes.values[1]);

        bytes memory baseURI = (
            abi.encodePacked(
                '{ "attributes": [',
                    '{"trait_type": "Issuing State", "value": "',
                    formatter.formatCountryName(attributes.values[0]),
                    '"},{"trait_type": "FirstName", "value": "',
                    firstName,
                    '"},{"trait_type": "LastName", "value": "',
                    lastName,
                    '"},{"trait_type": "Passport Number", "value": "',
                    attributes.values[2],
                    '"},{"trait_type": "Nationality", "value": "',
                    formatter.formatCountryName(attributes.values[3]),
                    '"},{"trait_type": "Date of birth", "value": "',
                    formatter.formatDate(attributes.values[4]),
                    '"},{"trait_type": "Gender", "value": "',
                    attributes.values[5],
                    '"},{"trait_type": "Expiry date", "value": "',
                    formatter.formatDate(attributes.values[6]),
                    '"},{"trait_type": "Expired", "value": "',
                    isExpired(_tokenId) ? "Yes" : "No",
                    '"},{"trait_type": "Older Than", "value": "',
                    formatter.formatAge(attributes.values[7]),
                    '"}',
                "],",
                '"description": "Proof of Passport guarantees possession of a valid passport.","external_url": "https://github.com/zk-passport/proof-of-passport","image": "https://i.imgur.com/9kvetij.png","name": "Proof of Passport #',
                _tokenId.toString(),
                '"}'
            )
        );

        return
            string(
                abi.encodePacked(
                    "data:application/json;base64,",
                    baseURI.encode()
                )
            );
    }

    function isExpired(uint256 _tokenId) public view returns (bool) {
        Attributes memory attributes = tokenAttributes[_tokenId];
        uint256 expiryDate = formatter.dateToUnixTimestamp(
            attributes.values[6]
        );

        return block.timestamp > expiryDate;
    }

    function getIssuingStateOf(
        uint256 _tokenId
    ) public view returns (string memory) {
        return tokenAttributes[_tokenId].values[0];
    }

    function getNameOf(uint256 _tokenId) public view returns (string memory) {
        return tokenAttributes[_tokenId].values[1];
    }

    function getPassportNumberOf(
        uint256 _tokenId
    ) public view returns (string memory) {
        return tokenAttributes[_tokenId].values[2];
    }

    function getNationalityOf(
        uint256 _tokenId
    ) public view returns (string memory) {
        return tokenAttributes[_tokenId].values[3];
    }

    function getDateOfBirthOf(
        uint256 _tokenId
    ) public view returns (string memory) {
        return tokenAttributes[_tokenId].values[4];
    }

    function getGenderOf(uint256 _tokenId) public view returns (string memory) {
        return tokenAttributes[_tokenId].values[5];
    }

    function getExpiryDateOf(
        uint256 _tokenId
    ) public view returns (string memory) {
        return tokenAttributes[_tokenId].values[6];
    }

    function getOlderThanOf(
        uint256 _tokenId
    ) public view returns (string memory) {
        return tokenAttributes[_tokenId].values[7];
    }

    function getCurrentTimestamp(uint256[6] memory dateNum) public view returns (uint256) {
        string memory date = "";
        for (uint i = 0; i < 6; i++) {
            date = string(abi.encodePacked(date, bytes1(uint8(48 + dateNum[i] % 10))));
        }
        uint256 currentTimestamp = formatter.dateToUnixTimestamp(date);
        return currentTimestamp;
    }

}