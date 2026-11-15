/*
 * Hide container and bridge interfaces from a process that publishes every
 * address it can see.
 *
 * Spotify Soloist builds its Connect announcement from getifaddrs and has no
 * option to pick the LAN interface. On a host that also runs Docker it then
 * announces 172.17.0.1, and a phone on the LAN never sees the device.
 *
 * Addresses are cleared in place. The list itself stays intact, so the
 * caller's freeifaddrs still frees the one block glibc allocated.
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <string.h>

static int hidden(const char *name) {
  if (name == NULL || name[0] == '\0') {
    return 0;
  }
  return strncmp(name, "docker", 6) == 0
      || strncmp(name, "br-", 3) == 0
      || strncmp(name, "veth", 4) == 0
      || strncmp(name, "virbr", 5) == 0
      || strncmp(name, "cni", 3) == 0
      || strncmp(name, "flannel", 7) == 0
      || strncmp(name, "cali", 4) == 0
      || strncmp(name, "vxlan", 3) == 0
      || strncmp(name, "tun", 3) == 0
      || strncmp(name, "tap", 3) == 0
      || strncmp(name, "wg", 2) == 0
      || strncmp(name, "zt", 2) == 0
      || strncmp(name, "tailscale", 9) == 0
      || strncmp(name, "lxc", 3) == 0
      || strncmp(name, "podman", 6) == 0
      || strncmp(name, "p2p", 3) == 0;
}

int getifaddrs(struct ifaddrs **ifap) {
  static int (*real_getifaddrs)(struct ifaddrs **) = NULL;
  if (real_getifaddrs == NULL) {
    real_getifaddrs = (int (*)(struct ifaddrs **))dlsym(RTLD_NEXT, "getifaddrs");
  }
  if (real_getifaddrs == NULL) {
    return -1;
  }
  int rc = real_getifaddrs(ifap);
  if (rc != 0 || ifap == NULL || *ifap == NULL) {
    return rc;
  }
  for (struct ifaddrs *cur = *ifap; cur != NULL; cur = cur->ifa_next) {
    if (!hidden(cur->ifa_name)) {
      continue;
    }
    cur->ifa_addr = NULL;
    cur->ifa_netmask = NULL;
    cur->ifa_broadaddr = NULL;
    cur->ifa_flags &= ~(unsigned)(IFF_UP | IFF_RUNNING | IFF_MULTICAST);
  }
  return 0;
}
