import { Url, parse as parseUrl } from 'url';
import * as https from 'https';
import * as vscode from 'vscode';
import { extensionConfig, apklabDataDir, outputChannel } from './common';
import * as fs from 'fs';
import * as path from 'path';
import * as config from './config.json';


interface Tool {
    name: string,
    version: string,
    downloadUrl: string,
    fileName: string,
    configName: string,
}

// check and download the tools
export function updateTools() {
    return new Promise((resolve, reject) => {
        const apktool = config.tools[0];
        const apktoolPath = extensionConfig.get(apktool.configName);
        const apktoolExists = apktoolPath && fs.existsSync(String(apktoolPath));
        const apkSigner = config.tools[1];
        const apkSignerPath = extensionConfig.get(apkSigner.configName);
        const apkSignerExists = apkSignerPath && fs.existsSync(String(apkSignerPath));
        if ((!apktoolExists || !apkSignerExists) && !fs.existsSync(apklabDataDir)) {
            fs.mkdirSync(apklabDataDir);
        }
        if (!apktoolExists) {
            DownloadFile(apktool).then(filePath => {
                if (!filePath) {
                    reject();
                }
                if (!apkSignerExists) {
                    DownloadFile(apkSigner).then(filePath => {
                        filePath ? resolve() : reject();
                    });
                } else {
                    resolve();
                }
            });
        } else {
            if (!apkSignerExists) {
                DownloadFile(apkSigner).then(filePath => {
                    filePath ? resolve() : reject();
                });
            } else {
                resolve();
            }
        }
    });
}

// download the tool
async function DownloadFile(tool: Tool) {
    try {
        outputChannel.show();
        outputChannel.appendLine(`Downloading file: ${tool.fileName}`);
        let buffer = await downloadFile(tool.downloadUrl);
        const filePath = path.join(apklabDataDir, tool.fileName);
        fs.writeFileSync(filePath, buffer);
        extensionConfig.update(tool.configName, filePath, vscode.ConfigurationTarget.Global);
        return filePath;
    } catch (error) {
        outputChannel.appendLine(`Error: Creating file`);
        return null;
    }

}

async function downloadFile(urlString: string): Promise<Buffer> {
    const url = parseUrl(urlString);
    const config = vscode.workspace.getConfiguration();
    const strictSSL = config.get('http.proxyStrictSSL', true);
    const options: https.RequestOptions = {
        host: url.hostname,
        path: url.path,
        port: url.port,
        rejectUnauthorized: strictSSL
    };

    let buffers: any[] = [];

    return new Promise<Buffer>((resolve, reject) => {
        let request = https.request(options, response => {
            if ((response.statusCode === 301 || response.statusCode === 302) && response.headers.location) {
                // Redirect - download from new location
                return resolve(downloadFile(response.headers.location));
            }

            else if (response.statusCode !== 200) {
                // Download failed - print error message
                outputChannel.appendLine("Download failed with response code: " + response.statusCode);
                reject("Failed");
            }

            // Downloading - hook up events
            let contentLength = response.headers["content-length"] ? response.headers["content-length"] : "0";
            let packageSize = parseInt(contentLength, 10);
            let downloadedBytes = 0;
            let downloadPercentage = 0;

            outputChannel.appendLine(`Download size: ${(packageSize / 1024 / 1024).toFixed(2)} MB`);

            response.on('data', data => {
                downloadedBytes += data.length;
                buffers.push(data);

                // Update status bar item with percentage
                let newPercentage = Math.ceil(100 * (downloadedBytes / packageSize));
                if (newPercentage !== downloadPercentage) {
                    downloadPercentage = newPercentage;
                    outputChannel.appendLine(`Downloaded ${downloadPercentage}%`);
                }
            });

            response.on('end', () => {
                resolve(Buffer.concat(buffers));
            });

            response.on('error', err => {
                reject(err.message);
            });
        });

        request.on('error', err => {
            reject(err.message);
        });

        // Execute the request
        request.end();
    });
}
