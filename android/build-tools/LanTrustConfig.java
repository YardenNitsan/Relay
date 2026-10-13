import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import java.util.Base64;
import java.util.regex.Pattern;

/** Build-time public certificate resource generator. Never linked into the APK. */
public final class LanTrustConfig {
    public static final String HOST = "10.100.102.30";
    private static final int MAX_CERTIFICATE_BYTES = 65536;
    private static final Pattern PEM = Pattern.compile(
        "\\A\\s*-----BEGIN CERTIFICATE-----\\s*([A-Za-z0-9+/=\\s]+)-----END CERTIFICATE-----\\s*\\z");

    public static byte[] validateCertificate(byte[] input) throws Exception {
        if (input.length == 0 || input.length > MAX_CERTIFICATE_BYTES)
            throw new IllegalArgumentException("Supply one public CA certificate of at most 64 KiB.");
        byte[] der = input;
        String text = new String(input, StandardCharsets.US_ASCII);
        if (text.contains("-----")) {
            var match = PEM.matcher(text);
            if (!match.matches())
                throw new IllegalArgumentException("PEM must contain exactly one public certificate, no private key or extra text.");
            der = Base64.getDecoder().decode(match.group(1).replaceAll("\\s", ""));
        }
        var stream = new ByteArrayInputStream(der);
        var certificate = (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(stream);
        if (stream.available() != 0 || !Arrays.equals(der, certificate.getEncoded()))
            throw new IllegalArgumentException("DER must contain exactly one complete certificate.");
        certificate.checkValidity();
        if (certificate.getBasicConstraints() < 0)
            throw new IllegalArgumentException("The build input must be a CA certificate, not a server certificate.");
        boolean[] usage = certificate.getKeyUsage();
        if (usage == null || usage.length <= 5 || !usage[5])
            throw new IllegalArgumentException("The CA certificate must explicitly allow certificate signing.");
        if (!certificate.getSubjectX500Principal().equals(certificate.getIssuerX500Principal()))
            throw new IllegalArgumentException("Supply the dedicated self-signed LAN root CA.");
        certificate.verify(certificate.getPublicKey());
        return certificate.getEncoded();
    }

    public static String networkConfig(String host) {
        // Do not interpolate an arbitrary domain or URL into XML. This profile is
        // intentionally valid for one owner-authorized literal IP only.
        if (!HOST.equals(host)) throw new IllegalArgumentException("LAN trust is restricted to " + HOST);
        return """
            <?xml version="1.0" encoding="utf-8"?>
            <network-security-config>
                <base-config cleartextTrafficPermitted="false">
                    <trust-anchors><certificates src="system" /></trust-anchors>
                </base-config>
                <domain-config cleartextTrafficPermitted="false">
                    <domain includeSubdomains="false">10.100.102.30</domain>
                    <trust-anchors><certificates src="@raw/relay_lan_ca" /></trust-anchors>
                </domain-config>
            </network-security-config>
            """;
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 3) throw new IllegalArgumentException("Expected public-CA path, exact LAN IP and output resource directory.");
        Path source = Path.of(args[0]);
        if (Files.size(source) > MAX_CERTIFICATE_BYTES)
            throw new IllegalArgumentException("CA input exceeds 64 KiB.");
        byte[] certificate = validateCertificate(Files.readAllBytes(source));
        String xml = networkConfig(args[1]);
        Path resources = Path.of(args[2]);
        Files.createDirectories(resources.resolve("raw"));
        Files.createDirectories(resources.resolve("xml"));
        Files.write(resources.resolve("raw/relay_lan_ca.der"), certificate);
        Files.writeString(resources.resolve("xml/relay_lan_network_security_config.xml"), xml, StandardCharsets.UTF_8);
    }
}
