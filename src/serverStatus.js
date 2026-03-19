const axios = require('axios');
const ping = require('ping-tcp-js');
const Discord = require('discord.js');
const Chalk = require('chalk');
const Config = require('../config.json');
const Status = require('../config/status-configs.js');
const db = require('./database.js');

const safePromise = async (promise) => {
    try {
        const rp = await promise;

        return [rp, null];
    } catch (e) {
        return [null, e];
    }
};

const startNodeChecker = () => {
    setInterval(async () => {

        for (const [, nodes] of Object.entries(Status.Nodes)) {
            for (const [node, data] of Object.entries(nodes)) {

                const [, fetchError] = await safePromise(ping.ping({ host: data.IP, port: 8080 }));

                if (fetchError) {
                    const [, pingError] = await safePromise(ping.ping({ host: data.IP, port: 22 }));

                    if (pingError) {
                        await db.setNodeStatusFields(node, { timestamp: Date.now(), status: false, is_vm_online: false });
                        continue;
                    }

                    await db.setNodeStatusFields(node, { timestamp: Date.now(), status: false, is_vm_online: true });

                } else {
                    await db.setNodeStatusFields(node, { timestamp: Date.now(), status: true, is_vm_online: true });
                }

                const [serverCountRes, serverCountError] = await safePromise(axios({
                    url: `${Config.Pterodactyl.hosturl}/api/application/nodes/${data.ID}/allocations?per_page=9000`,
                    method: "GET",
                    headers: {
                        "Authorization": `Bearer ${Config.Pterodactyl.apikey}`,
                        "Content-Type": "application/json",
                        "Accept": "Application/vnd.pterodactyl.v1+json",
                    },
                }));

                if (serverCountError || !serverCountRes) {                    
                    continue;
                }

                const serverCount = serverCountRes.data.data.filter(m => m.attributes.assigned).length;

                await db.setNodeServers(node, {
                    servers: serverCount,
                    maxCount: data.MaxLimit
                });
            }
        }

        for (const [category, services] of Object.entries(Status)) {
            if (category !== "Nodes") {
                for (const [name, data] of Object.entries(services)) {
                    const [, error] = await safePromise(ping.ping({ host: data.IP, port: 22}));

                    if (error) {
                        await db.setNodeStatusFields(name, { timestamp: Date.now(), status: false });
                        continue;
                    }

                    await db.setNodeStatusFields(name, { timestamp: Date.now(), status: true });
                }
            }
        }
    }, 5 * 1000);
}

const parseStatus = async () => {
    const toReturn = {};

    // Handle Nodes categories.
    for (const [category, nodes] of Object.entries(Status.Nodes)) {
        const temp = [];
        for (const [nodeKey, data] of Object.entries(nodes)) {

            const [nodeStatusData, nodeServerData] = await Promise.all([
                db.getNodeStatus(nodeKey.toLowerCase()),
                db.getNodeServers(nodeKey.toLowerCase()),
            ]);

            const serverUsage = await nodeServerData
                ? `(${nodeServerData.servers} / ${nodeServerData.maxCount})`
                : "";

            let statusText;
            if (nodeStatusData?.maintenance) {
                statusText = `🟣 Maintenance ~ Returning Soon!`;
            } else if (nodeStatusData?.status) {
                statusText = `🟢 Online ${serverUsage}`;
            } else if (nodeStatusData?.is_vm_online == null) {
                statusText = "🔴 **Offline**";
            } else {
                statusText = (nodeStatusData.is_vm_online ? "🟠 **Wings**" : "🔴 **System**") +
                    ` **offline** ${serverUsage}`;
            }

            temp.push(`${data.Name}: ${statusText}`);
        }
        toReturn[category] = temp;
    }

    // Handle other categories.
    for (const [category, services] of Object.entries(Status)) {
        if (category !== "Nodes") {
            const temp = [];
            for (const [name, data] of Object.entries(services)) {

                const serviceStatusData = await db.getNodeStatus(name.toLowerCase());

                const statusText = serviceStatusData?.status ? "🟢 Online" : "🔴 **Offline**";

                temp.push(`${data.name}: ${statusText}`);
            }
            toReturn[category] = temp;
        }
    }

    return toReturn;
};


const getEmbed = async () => {
    const status = await parseStatus();
    let desc = "";

    for (const [title, d] of Object.entries(status)) {
        desc = `${desc}***${title}***\n${d.join("\n")}\n\n`;
    }

    const embed = new Discord.EmbedBuilder();

    embed.setTitle("DBH Service Status");
    embed.setDescription(desc);
    embed.setTimestamp();
    embed.setColor("#7388d9");
    embed.setFooter({ text: "Last Updated" });

    return embed;
};

const cleanupStaleNodes = async () => {
    const activeStatusKeys = new Set();
    const activeServersKeys = new Set();

    for (const [, nodes] of Object.entries(Status.Nodes)) {
        for (const node of Object.keys(nodes)) {
            activeStatusKeys.add(node.toLowerCase());
            activeServersKeys.add(node.toLowerCase());
        }
    }

    for (const [category, services] of Object.entries(Status)) {
        if (category !== "Nodes") {
            for (const name of Object.keys(services)) {
                activeStatusKeys.add(name.toLowerCase());
            }
        }
    }

    const [allStatusKeys, allServersKeys] = await Promise.all([
        db.getAllNodeStatusKeys(),
        db.getAllNodeServersKeys(),
    ]);

    const staleStatusKeys = allStatusKeys.filter(k => !activeStatusKeys.has(k));
    const staleServersKeys = allServersKeys.filter(k => !activeServersKeys.has(k));

    await Promise.all([
        db.deleteNodeStatusByKeys(staleStatusKeys),
        db.deleteNodeServersByKeys(staleServersKeys),
    ]);

    console.log(Chalk.magenta("[DATABASE CLEANUP] ") + Chalk.greenBright(`Removed ${staleStatusKeys.length} stale nodeStatus and ${staleServersKeys.length} stale nodeServers entries.`));
};

const startCleanupTask = () => {
    cleanupStaleNodes();
    setInterval(cleanupStaleNodes, 24 * 60 * 60 * 1000);
};

module.exports = { startNodeChecker, startCleanupTask, parseStatus, getEmbed };
