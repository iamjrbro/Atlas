function Send-AtlasSnapshot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$AtlasUrl,
        [Parameter(Mandatory)][Guid]$TenantId,
        [Parameter(Mandatory)][ValidateSet('bridge.exchange','bridge.sharepoint')][string]$Source,
        [Parameter(Mandatory)][object[]]$Records,
        [Parameter(Mandatory)][bool]$Complete
    )
    $atlasUri = [Uri]$AtlasUrl
    if ($atlasUri.Scheme -ne 'https' -and $atlasUri.Host -notin @('localhost','127.0.0.1')) { throw 'AtlasUrl exige HTTPS.' }
    $bridgeKey = $env:ATLAS_BRIDGE_HMAC_KEY
    if ([string]::IsNullOrEmpty($bridgeKey) -or $bridgeKey.Length -lt 32) { throw 'Configure ATLAS_BRIDGE_HMAC_KEY no secret store da execução.' }
    $body = @{ tenantId=$TenantId.ToString(); source=$Source; capturedAt=[DateTime]::UtcNow.ToString('o'); complete=$Complete; records=@($Records) } | ConvertTo-Json -Depth 50 -Compress
    $bodyBytes = [Text.Encoding]::UTF8.GetBytes($body)
    $digest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bodyBytes)).ToLowerInvariant()
    $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
    $nonce = [Guid]::NewGuid().ToString('N')
    $hmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($bridgeKey))
    try { $signature = [Convert]::ToHexString($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes("$timestamp.$nonce.$digest"))).ToLowerInvariant() } finally { $hmac.Dispose() }
    $headers = @{ 'x-atlas-tenant'=$TenantId.ToString(); 'x-atlas-timestamp'=$timestamp; 'x-atlas-nonce'=$nonce; 'x-atlas-signature'=$signature }
    # Não imprimir corpo, assinatura, chave ou tokens.
    Invoke-RestMethod -Method Post -Uri ($AtlasUrl.TrimEnd('/') + '/bridge/v1/snapshots') -ContentType 'application/json; charset=utf-8' -Headers $headers -Body $bodyBytes -MaximumRedirection 0
}
