{ ... }:
{
  services = {
    # tailscale.enable = true;
    resolved.enable = true;
    resolved.settings.Resolve = {
      DNSSEC = false;
    };

    dnsmasq = {
      enable = true;
      settings = {
        listen-address = "127.0.0.1";
        bind-interfaces = true;
        server = [ "1.1.1.3" ];
        no-resolv = true;
        addn-hosts = "/opt/blocklist.hosts";
        cache-size = 1000;
      };
    };
  };

  networking = {
    useDHCP = false;
    hostName = "M16";
    useNetworkd = true;
    wireless.iwd.enable = true;
    nameservers = [ "127.0.0.1" ]; # dnsmasq setup
    networkmanager.enable = false; # disable in favor if networkd
    firewall = {
      enable = true;
      allowedTCPPorts = [
        27037
        47624
      ];
      allowedUDPPorts = [
        4380
        27000
        27015
      ];
      allowedUDPPortRanges = [
        {
          from = 60000;
          to = 61000;
        }
      ];
    };
  };

  systemd.network = {
    wait-online.timeout = 10;
    wait-online.anyInterface = true;
    networks = {
      "40-wired" = {
        matchConfig.Name = "eno2";
        networkConfig = {
          DHCP = "yes";
          DNS = "127.0.0.1";
        };
        dhcpV4Config.UseDNS = false;
        dhcpV6Config.UseDNS = false;
      };
      "40-wireless" = {
        matchConfig.Name = "wlan0";
        networkConfig = {
          DHCP = "yes";
          DNS = "127.0.0.1";
        };
        dhcpV4Config.UseDNS = false;
        dhcpV6Config.UseDNS = false;
      };
      # "50-tailscale" = {
      #   matchConfig.Name = "tailscale0";
      # };
    };
  };

  boot.kernel.sysctl."net.ipv4.ip_forward" = 1;
}
