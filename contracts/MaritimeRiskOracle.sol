// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {IFdcVerification} from "@flarenetwork/flare-periphery-contracts/coston2/IFdcVerification.sol";
import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";

/**
 * @title MaritimeRiskOracle
 * @notice Core contract for receiving and verifying maritime data from Flare Data Connector (FDC)
 * @dev Supports PSC Detention, Casualty, Dry Dock, and Vessel tracking data from Datalastic API
 */
contract MaritimeRiskOracle {
    
    // ============ Data Structures ============
    
    struct PSCInspection {
        string imo;
        string vesselName;
        string inspectionDate;
        bool detained;
        uint256 deficiencyCount;
        string inspectionPort;
        string inspectionAuthority;
        uint256 timestamp;
    }
    
    struct Casualty {
        string imo;
        string vesselName;
        string casualtyDate;
        string casualtyType;
        string casualtyDetails;
        uint256 timestamp;
    }
    
    struct DryDock {
        string imo;
        string vesselName;
        string dryDockFrom;
        string dryDockTo;
        string status; // "planned" or "completed"
        uint256 timestamp;
    }
    
    struct VesselPosition {
        string imo;
        string vesselName;
        int256 latitude;  // Scaled by 1e6
        int256 longitude; // Scaled by 1e6
        string navigationStatus;
        string destination;
        uint256 timestamp;
    }
    
    // ============ Storage ============
    
    mapping(string => PSCInspection[]) public pscInspections; // imo => inspections
    mapping(string => Casualty[]) public casualties;          // imo => casualties
    mapping(string => DryDock[]) public dryDocks;             // imo => dry docks
    mapping(string => VesselPosition) public vesselPositions; // imo => latest position
    
    address public owner;
    mapping(address => bool) public authorizedSubmitters;
    
    // ============ Events ============
    
    event PSCInspectionRecorded(
        string indexed imo,
        bool detained,
        uint256 deficiencyCount,
        string inspectionPort
    );
    
    event CasualtyRecorded(
        string indexed imo,
        string casualtyType,
        string casualtyDate
    );
    
    event DryDockRecorded(
        string indexed imo,
        string dryDockFrom,
        string dryDockTo
    );
    
    event VesselPositionUpdated(
        string indexed imo,
        int256 latitude,
        int256 longitude,
        string navigationStatus
    );
    
    // ============ Modifiers ============
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }
    
    modifier onlyAuthorized() {
        require(authorizedSubmitters[msg.sender] || msg.sender == owner, "Not authorized");
        _;
    }
    
    // ============ Constructor ============
    
    constructor() {
        owner = msg.sender;
        authorizedSubmitters[msg.sender] = true;
    }
    
    // ============ Admin Functions ============
    
    function setAuthorizedSubmitter(address submitter, bool authorized) external onlyOwner {
        authorizedSubmitters[submitter] = authorized;
    }
    
    // ============ FDC Verification ============
    
    /**
     * @notice Verifies a Web2Json proof from Flare Data Connector
     * @param _proof The proof structure from FDC
     * @return True if the proof is valid
     */
    function verifyWeb2JsonProof(IWeb2Json.Proof calldata _proof) public view returns (bool) {
        IFdcVerification fdcVerification = ContractRegistry.getFdcVerification();
        return fdcVerification.verifyWeb2Json(_proof);
    }
    
    // ============ Data Submission with FDC Verification ============
    
    /**
     * @notice Submit PSC inspection data verified by FDC
     * @param _proof The Web2Json proof from FDC containing inspection data
     * @dev Expected ABI: {imo: string, vessel_name: string, inspection_date: string, 
     *                     detention: string, ship_deficiencies: string, inspection_port: string,
     *                     inspection_authority: string}
     */
    function submitPSCInspectionWithProof(IWeb2Json.Proof calldata _proof) external {
        require(verifyWeb2JsonProof(_proof), "Invalid FDC proof");
        
        // Decode the ABI-encoded data from the proof
        (
            string memory imo,
            string memory vesselName,
            string memory inspectionDate,
            string memory detentionStr,
            uint256 deficiencyCount,
            string memory inspectionPort,
            string memory inspectionAuthority
        ) = abi.decode(
            _proof.data.responseBody.abiEncodedData,
            (string, string, string, string, uint256, string, string)
        );
        
        bool detained = keccak256(bytes(detentionStr)) == keccak256(bytes("TRUE"));
        
        PSCInspection memory inspection = PSCInspection({
            imo: imo,
            vesselName: vesselName,
            inspectionDate: inspectionDate,
            detained: detained,
            deficiencyCount: deficiencyCount,
            inspectionPort: inspectionPort,
            inspectionAuthority: inspectionAuthority,
            timestamp: block.timestamp
        });
        
        pscInspections[imo].push(inspection);
        
        emit PSCInspectionRecorded(imo, detained, deficiencyCount, inspectionPort);
    }
    
    /**
     * @notice Submit casualty data verified by FDC
     * @param _proof The Web2Json proof from FDC containing casualty data
     * @dev Expected ABI: {imo: string, vessel_name: string, casualty_date: string,
     *                     casualty_type: string, casualty_details: string}
     */
    function submitCasualtyWithProof(IWeb2Json.Proof calldata _proof) external {
        require(verifyWeb2JsonProof(_proof), "Invalid FDC proof");
        
        (
            string memory imo,
            string memory vesselName,
            string memory casualtyDate,
            string memory casualtyType,
            string memory casualtyDetails
        ) = abi.decode(
            _proof.data.responseBody.abiEncodedData,
            (string, string, string, string, string)
        );
        
        Casualty memory casualty = Casualty({
            imo: imo,
            vesselName: vesselName,
            casualtyDate: casualtyDate,
            casualtyType: casualtyType,
            casualtyDetails: casualtyDetails,
            timestamp: block.timestamp
        });
        
        casualties[imo].push(casualty);
        
        emit CasualtyRecorded(imo, casualtyType, casualtyDate);
    }
    
    /**
     * @notice Submit dry dock data verified by FDC
     * @param _proof The Web2Json proof from FDC containing dry dock data
     */
    function submitDryDockWithProof(IWeb2Json.Proof calldata _proof) external {
        require(verifyWeb2JsonProof(_proof), "Invalid FDC proof");
        
        (
            string memory imo,
            string memory vesselName,
            string memory dryDockFrom,
            string memory dryDockTo,
            string memory status
        ) = abi.decode(
            _proof.data.responseBody.abiEncodedData,
            (string, string, string, string, string)
        );
        
        DryDock memory dryDock = DryDock({
            imo: imo,
            vesselName: vesselName,
            dryDockFrom: dryDockFrom,
            dryDockTo: dryDockTo,
            status: status,
            timestamp: block.timestamp
        });
        
        dryDocks[imo].push(dryDock);
        
        emit DryDockRecorded(imo, dryDockFrom, dryDockTo);
    }
    
    /**
     * @notice Submit vessel position data verified by FDC
     * @param _proof The Web2Json proof from FDC containing position data
     */
    function submitVesselPositionWithProof(IWeb2Json.Proof calldata _proof) external {
        require(verifyWeb2JsonProof(_proof), "Invalid FDC proof");
        
        (
            string memory imo,
            string memory vesselName,
            int256 latitude,
            int256 longitude,
            string memory navigationStatus,
            string memory destination
        ) = abi.decode(
            _proof.data.responseBody.abiEncodedData,
            (string, string, int256, int256, string, string)
        );
        
        vesselPositions[imo] = VesselPosition({
            imo: imo,
            vesselName: vesselName,
            latitude: latitude,
            longitude: longitude,
            navigationStatus: navigationStatus,
            destination: destination,
            timestamp: block.timestamp
        });
        
        emit VesselPositionUpdated(imo, latitude, longitude, navigationStatus);
    }
    
    // ============ Manual Data Submission (for testing/authorized sources) ============
    
    function submitPSCInspectionManual(
        string calldata imo,
        string calldata vesselName,
        string calldata inspectionDate,
        bool detained,
        uint256 deficiencyCount,
        string calldata inspectionPort,
        string calldata inspectionAuthority
    ) external onlyAuthorized {
        PSCInspection memory inspection = PSCInspection({
            imo: imo,
            vesselName: vesselName,
            inspectionDate: inspectionDate,
            detained: detained,
            deficiencyCount: deficiencyCount,
            inspectionPort: inspectionPort,
            inspectionAuthority: inspectionAuthority,
            timestamp: block.timestamp
        });
        
        pscInspections[imo].push(inspection);
        emit PSCInspectionRecorded(imo, detained, deficiencyCount, inspectionPort);
    }
    
    function submitCasualtyManual(
        string calldata imo,
        string calldata vesselName,
        string calldata casualtyDate,
        string calldata casualtyType,
        string calldata casualtyDetails
    ) external onlyAuthorized {
        Casualty memory casualty = Casualty({
            imo: imo,
            vesselName: vesselName,
            casualtyDate: casualtyDate,
            casualtyType: casualtyType,
            casualtyDetails: casualtyDetails,
            timestamp: block.timestamp
        });
        
        casualties[imo].push(casualty);
        emit CasualtyRecorded(imo, casualtyType, casualtyDate);
    }
    
    // ============ Query Functions ============
    
    function getPSCInspectionCount(string calldata imo) external view returns (uint256) {
        return pscInspections[imo].length;
    }
    
    function getLatestPSCInspection(string calldata imo) external view returns (PSCInspection memory) {
        require(pscInspections[imo].length > 0, "No inspections");
        return pscInspections[imo][pscInspections[imo].length - 1];
    }
    
    function wasVesselDetained(string calldata imo, string calldata fromDate, string calldata toDate) 
        external view returns (bool) 
    {
        PSCInspection[] storage inspections = pscInspections[imo];
        for (uint256 i = 0; i < inspections.length; i++) {
            if (inspections[i].detained) {
                // Simple check - in production, compare dates properly
                return true;
            }
        }
        return false;
    }
    
    function getCasualtyCount(string calldata imo) external view returns (uint256) {
        return casualties[imo].length;
    }
    
    function getLatestCasualty(string calldata imo) external view returns (Casualty memory) {
        require(casualties[imo].length > 0, "No casualties");
        return casualties[imo][casualties[imo].length - 1];
    }
    
    function hadCasualty(string calldata imo, string calldata casualtyType) 
        external view returns (bool) 
    {
        Casualty[] storage vesselCasualties = casualties[imo];
        for (uint256 i = 0; i < vesselCasualties.length; i++) {
            if (keccak256(bytes(vesselCasualties[i].casualtyType)) == keccak256(bytes(casualtyType))) {
                return true;
            }
        }
        return false;
    }
    
    function getVesselPosition(string calldata imo) external view returns (VesselPosition memory) {
        return vesselPositions[imo];
    }
    
    function isVesselMoored(string calldata imo) external view returns (bool) {
        VesselPosition storage pos = vesselPositions[imo];
        return keccak256(bytes(pos.navigationStatus)) == keccak256(bytes("Moored"));
    }
}
