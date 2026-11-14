import type { LoxoneHttpConfig } from '@/config/loxone';
import type { ConfigPort } from '@/ports/ConfigPort';
import type { MdnsPort, MdnsRegistration } from '@/ports/MdnsPort';
import { resolveMdnsHost } from '@/shared/utils/net';
import { createLogger } from '@/shared/logging/logger';
import { loxoneDiscoveryFields } from '@/adapters/loxone/http/loxoneUdpDiscovery';

/**
 * Bonjour record for the Loxone search. The fields were already configured and
 * then never published, so a client that looks the server up by name found nothing.
 */
export class LoxoneMdnsAdvertiser {
  private readonly log = createLogger('Loxone', 'Mdns');
  private registration: MdnsRegistration | null = null;

  constructor(private readonly mdns: MdnsPort) {}

  public publish(config: LoxoneHttpConfig, configPort: ConfigPort): void {
    this.stop();
    const fields = loxoneDiscoveryFields(config, configPort);
    const systemIp = configPort.getSystemConfig()?.audioserver?.ip?.trim();
    const txt = {
      devicetype: config.mdns.deviceType,
      version: config.mdns.version,
      txtvers: config.mdns.txtVersion,
      deviceinstance: config.mdns.deviceInstance,
      mac: fields.mac,
      hostname: fields.hostname,
    };
    this.registration = this.mdns.publish({
      name: fields.name,
      type: config.mdns.type,
      protocol: 'tcp',
      port: fields.port,
      host: resolveMdnsHost(config.mdns.host, systemIp),
      txt,
    });
    this.log.info('loxone audioserver advertised via mDNS', {
      name: fields.name,
      port: fields.port,
      txt,
    });
  }

  public stop(): void {
    this.registration?.stop();
    this.registration = null;
  }
}
