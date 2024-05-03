import fs from 'fs';
import chalk from 'chalk';
import {Config} from "./config";
import {Namer} from "./Core/Namer";
import {Writer} from "./Core/Writer";
import {Reporter} from "./Core/Reporter";
import {ReporterLoader} from "./Reporting/ReporterFactory";

interface Options {
    stripBOM?: boolean;
    forceApproveAll?: boolean;
    failOnLineEndingDifferences?: boolean;
    shouldIgnoreStaleApprovedFile?(fileName: string): boolean;
}

function normalizeLineEndings(value: string): string {
    return value.replace(/(?:\r\n|\r|\n)/g, '\n');
}

export class FileApprover{



static verify(namer: Namer, writer: Writer, reporterFactory: ReporterLoader, options?: Partial<Config>): void {
    if (!namer || !writer || !reporterFactory) {
        throw new Error("Missing required arguments: 'namer', 'writer', or 'reporterFactory'.");
    }
    if (!options) {
        options = {}
    }

    const approvedFileName = namer.getApprovedFile(writer.getFileExtension());
    const receivedFileName = namer.getReceivedFile(writer.getFileExtension());

    writer.write(receivedFileName);

    if ( options.forceApproveAll) {
        console.log(chalk.yellow(`WARNING: Force approving: ${approvedFileName}`));
        writer.write(approvedFileName);
    }

    const selectFirstCompatibleReporter = (): Reporter => {
        const allReporters = reporterFactory();
        const reporter = allReporters.find(reporter => reporter.canReportOn(receivedFileName));
        if (!reporter) {
            throw new Error(`No compatible reporter found in configured list [${allReporters.map(r => r.name).join(', ')}] for: ${receivedFileName}`);
        }
        return reporter;
    };

    const throwReporterError = (msg: string): never => {
        const reporter = selectFirstCompatibleReporter();
        try {
            reporter.report(approvedFileName, receivedFileName, options);
        } catch (ex) {
            const reporterError = `Error raised by reporter [${reporter.name}]: ${ex}`;
            throw new Error(`${reporterError}\n${msg}\nApproved: ${approvedFileName}\nReceived: ${receivedFileName}`);
        }
        throw new Error(msg);
    };

    if (!fs.existsSync(approvedFileName)) {
        throwReporterError(`Approved file does not exist: ${approvedFileName}`);
    }

    let approvedFileContents = fs.readFileSync(approvedFileName, 'utf8') || "";
    let receivedFileContents = fs.readFileSync(receivedFileName, 'utf8') || "";

    if (options.stripBOM) {
        approvedFileContents = approvedFileContents.replace(/^\uFEFF/, '');
        receivedFileContents = receivedFileContents.replace(/^\uFEFF/, '');
    }

    if (options.failOnLineEndingDifferences && approvedFileContents !== receivedFileContents) {
        throwReporterError("Files do not match.");
    }

    const approvedFileBufferNormalized = normalizeLineEndings(approvedFileContents);
    const receivedFileBufferNormalized = normalizeLineEndings(receivedFileContents);

    if (approvedFileBufferNormalized !== receivedFileBufferNormalized) {
        throwReporterError("Files do not match.");
    }

    // Delete the received file
    fs.unlinkSync(receivedFileName);

    (process.emit as Function)('approvalFileApproved', approvedFileName);
}}

export function verify(namer: Namer, writer: Writer, reporterFactory: () => Reporter[], options?: Partial<Config>): void {
    FileApprover.verify(namer, writer, reporterFactory, options);
}
